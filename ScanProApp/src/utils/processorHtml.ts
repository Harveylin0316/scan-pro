// HTML injected into the hidden WebView for all image processing.
// Communicates with React Native via postMessage / injectJavaScript.
//
// Messages TO WebView (via injectJavaScript):
//   { type: 'detect', imageBase64: string }
//   { type: 'process', imageBase64, corners, filter, brightness, contrast }
//
// Messages FROM WebView (via ReactNativeWebView.postMessage):
//   { type: 'detected', corners: Corner[], imageWidth, imageHeight }
//   { type: 'processed', processed: string, thumb: string }
//   { type: 'error', message: string }

export const PROCESSOR_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>body{margin:0;}</style></head>
<body>
<script>
// ─── A4 fallback corners ──────────────────────────────────────────────────────
function getA4Fallback(imgW, imgH) {
  var ratio = 210 / 297; // A4 w/h
  var pad = 0.04;
  var maxW = 1 - pad * 2, maxH = 1 - pad * 2;
  var target = ratio * (imgH / imgW);
  var cW, cH;
  if (target <= 1) { cH = maxH; cW = cH * target; if (cW > maxW) { cW = maxW; cH = cW / target; } }
  else { cW = maxW; cH = cW / target; if (cH > maxH) { cH = maxH; cW = cH * target; } }
  var x1 = (1 - cW) / 2, y1 = (1 - cH) / 2;
  return [{x:x1,y:y1},{x:x1+cW,y:y1},{x:x1+cW,y:y1+cH},{x:x1,y:y1+cH}];
}

// ─── Corner Detection ────────────────────────────────────────────────────────
function detectDocumentCorners(img) {
  var cw = 400;
  var scale = cw / img.width;
  var ch = Math.round(img.height * scale);

  var c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  var ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, cw, ch);
  var imageData = ctx.getImageData(0, 0, cw, ch);
  var data = imageData.data;

  var gray = new Uint8Array(cw * ch);
  var hist = new Uint32Array(256);
  for (var i = 0; i < gray.length; i++) {
    var g = (data[i*4] * 0.299 + data[i*4+1] * 0.587 + data[i*4+2] * 0.114) | 0;
    gray[i] = g;
    hist[g]++;
  }

  // Histogram equalization
  var cdf = new Uint32Array(256);
  cdf[0] = hist[0];
  for (var i = 1; i < 256; i++) cdf[i] = cdf[i-1] + hist[i];
  var cdfMin = 0;
  for (var i = 0; i < 256; i++) { if (cdf[i] > 0) { cdfMin = cdf[i]; break; } }
  var total = cw * ch;
  for (var i = 0; i < gray.length; i++) {
    gray[i] = Math.round(((cdf[gray[i]] - cdfMin) / (total - cdfMin)) * 255);
  }

  // Gaussian blur 3x3
  var blurred = new Uint8Array(cw * ch);
  for (var y = 1; y < ch - 1; y++) {
    for (var x = 1; x < cw - 1; x++) {
      var idx = y * cw + x;
      blurred[idx] = (
        gray[idx-cw-1] + 2*gray[idx-cw] + gray[idx-cw+1] +
        2*gray[idx-1] + 4*gray[idx] + 2*gray[idx+1] +
        gray[idx+cw-1] + 2*gray[idx+cw] + gray[idx+cw+1]
      ) / 16 | 0;
    }
  }

  // Sobel edges
  var edges = new Uint8Array(cw * ch);
  for (var y = 1; y < ch - 1; y++) {
    for (var x = 1; x < cw - 1; x++) {
      var idx = y * cw + x;
      var gx = -blurred[idx-cw-1] + blurred[idx-cw+1]
               -2*blurred[idx-1] + 2*blurred[idx+1]
               -blurred[idx+cw-1] + blurred[idx+cw+1];
      var gy = -blurred[idx-cw-1] - 2*blurred[idx-cw] - blurred[idx-cw+1]
               +blurred[idx+cw-1] + 2*blurred[idx+cw] + blurred[idx+cw+1];
      edges[idx] = Math.min(255, Math.sqrt(gx*gx + gy*gy) | 0);
    }
  }

  // Adaptive threshold (70th percentile)
  var edgeVals = [];
  for (var i = 0; i < edges.length; i++) { if (edges[i] > 10) edgeVals.push(edges[i]); }
  edgeVals.sort(function(a,b){return a-b;});
  var threshold = edgeVals.length > 100
    ? Math.max(40, edgeVals[Math.floor(edgeVals.length * 0.6)])
    : 50;

  // Dilate edges
  var dilated = new Uint8Array(cw * ch);
  for (var y = 1; y < ch - 1; y++) {
    for (var x = 1; x < cw - 1; x++) {
      var idx = y * cw + x;
      if (edges[idx] > threshold ||
          edges[idx-1] > threshold || edges[idx+1] > threshold ||
          edges[idx-cw] > threshold || edges[idx+cw] > threshold) {
        dilated[idx] = 255;
      }
    }
  }

  var margin = Math.round(cw * 0.06);
  var topEdge = ch, bottomEdge = 0, leftEdge = cw, rightEdge = 0;
  var edgeCount = 0;
  for (var y = margin; y < ch - margin; y++) {
    for (var x = margin; x < cw - margin; x++) {
      if (dilated[y * cw + x]) {
        if (y < topEdge) topEdge = y;
        if (y > bottomEdge) bottomEdge = y;
        if (x < leftEdge) leftEdge = x;
        if (x > rightEdge) rightEdge = x;
        edgeCount++;
      }
    }
  }

  if (rightEdge - leftEdge < cw * 0.25 || bottomEdge - topEdge < ch * 0.25 || edgeCount < 100) {
    return getA4Fallback(img.width, img.height);
  }

  var cx = (leftEdge + rightEdge) / 2;
  var cy = (topEdge + bottomEdge) / 2;

  function findCorner(startX, startY, endX, endY) {
    var bestX = startX, bestY = startY, bestScore = 0;
    var step = 3;
    for (var y = Math.min(startY, endY); y <= Math.max(startY, endY); y += step) {
      for (var x = Math.min(startX, endX); x <= Math.max(startX, endX); x += step) {
        if (x >= 0 && x < cw && y >= 0 && y < ch && dilated[y * cw + x]) {
          var score = Math.abs(x - cx) + Math.abs(y - cy);
          if (score > bestScore) { bestScore = score; bestX = x; bestY = y; }
        }
      }
    }
    return {x: bestX, y: bestY};
  }

  var tl = findCorner(leftEdge, topEdge, cx, cy);
  var tr = findCorner(cx, topEdge, rightEdge, cy);
  var br = findCorner(cx, cy, rightEdge, bottomEdge);
  var bl = findCorner(leftEdge, cy, cx, bottomEdge);

  var p = cw * 0.015;
  return [
    {x: Math.max(0, (tl.x - p)) / cw, y: Math.max(0, (tl.y - p)) / ch},
    {x: Math.min(cw, (tr.x + p)) / cw, y: Math.max(0, (tr.y - p)) / ch},
    {x: Math.min(cw, (br.x + p)) / cw, y: Math.min(ch, (br.y + p)) / ch},
    {x: Math.max(0, (bl.x - p)) / cw, y: Math.min(ch, (bl.y + p)) / ch},
  ];
}

// ─── Perspective Transform ────────────────────────────────────────────────────
function perspectiveTransform(img, corners) {
  var sw = img.width, sh = img.height;
  var pts = corners.map(function(c) {
    return {
      x: Math.max(0, Math.min(1, c.x)) * sw,
      y: Math.max(0, Math.min(1, c.y)) * sh,
    };
  });

  var widthTop   = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  var widthBot   = Math.hypot(pts[2].x - pts[3].x, pts[2].y - pts[3].y);
  var heightLeft = Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y);
  var heightRight= Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y);

  var dw = Math.max(1, Math.round(Math.max(widthTop, widthBot)));
  var dh = Math.max(1, Math.round(Math.max(heightLeft, heightRight)));

  var maxDim = 2500;
  var outScale = Math.min(1, maxDim / Math.max(dw, dh));
  var ow = Math.round(dw * outScale);
  var oh = Math.round(dh * outScale);

  var srcCanvas = document.createElement('canvas');
  srcCanvas.width = sw; srcCanvas.height = sh;
  srcCanvas.getContext('2d').drawImage(img, 0, 0);
  var srcData = srcCanvas.getContext('2d').getImageData(0, 0, sw, sh);

  var dstCanvas = document.createElement('canvas');
  dstCanvas.width = ow; dstCanvas.height = oh;
  var dstCtx = dstCanvas.getContext('2d');
  var dstData = dstCtx.createImageData(ow, oh);

  for (var dy = 0; dy < oh; dy++) {
    for (var dx = 0; dx < ow; dx++) {
      var u = dx / (ow - 1 || 1);
      var v = dy / (oh - 1 || 1);

      var sx = (1-u)*(1-v)*pts[0].x + u*(1-v)*pts[1].x + u*v*pts[2].x + (1-u)*v*pts[3].x;
      var sy = (1-u)*(1-v)*pts[0].y + u*(1-v)*pts[1].y + u*v*pts[2].y + (1-u)*v*pts[3].y;

      var floorX = Math.floor(sx);
      var floorY = Math.floor(sy);
      var fracX  = sx - floorX;
      var fracY  = sy - floorY;

      if (floorX >= 0 && floorX < sw - 1 && floorY >= 0 && floorY < sh - 1) {
        var di  = (dy * ow + dx) * 4;
        var i00 = (floorY * sw + floorX) * 4;
        var i10 = i00 + 4;
        var i01 = i00 + sw * 4;
        var i11 = i01 + 4;
        for (var ch = 0; ch < 3; ch++) {
          dstData.data[di+ch] = (
            srcData.data[i00+ch] * (1-fracX) * (1-fracY) +
            srcData.data[i10+ch] * fracX     * (1-fracY) +
            srcData.data[i01+ch] * (1-fracX) * fracY     +
            srcData.data[i11+ch] * fracX     * fracY
          ) | 0;
        }
        dstData.data[di+3] = 255;
      }
    }
  }

  dstCtx.putImageData(dstData, 0, 0);
  return dstCanvas;
}

// ─── Filter Application ───────────────────────────────────────────────────────
function applyScanFilter(canvas, filter, brightness, contrast) {
  var ctx = canvas.getContext('2d');
  var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  var data = imageData.data;
  var bAdj = brightness * 2;
  var cFactor = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55));

  for (var i = 0; i < data.length; i += 4) {
    var r = data[i], g = data[i+1], b = data[i+2];
    r += bAdj; g += bAdj; b += bAdj;
    r = cFactor * (r - 128) + 128;
    g = cFactor * (g - 128) + 128;
    b = cFactor * (b - 128) + 128;

    if (filter === 'scan') {
      var gray = 0.299 * r + 0.587 * g + 0.114 * b;
      if (gray > 170) { r = g = b = Math.min(255, gray + 50); }
      else if (gray > 80) { r *= 0.9; g *= 0.9; b *= 0.9; }
      else { r *= 0.75; g *= 0.75; b *= 0.75; }
      r = 1.4 * (r - 128) + 128;
      g = 1.4 * (g - 128) + 128;
      b = 1.4 * (b - 128) + 128;
    } else if (filter === 'bw') {
      var gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = gray > 120 ? 255 : 0;
    } else if (filter === 'gray') {
      var gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = gray;
    }
    // 'color' → no change beyond brightness/contrast

    data[i]   = Math.max(0, Math.min(255, r));
    data[i+1] = Math.max(0, Math.min(255, g));
    data[i+2] = Math.max(0, Math.min(255, b));
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// ─── Load image from base64 ───────────────────────────────────────────────────
function loadImage(src) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.onload = function() { resolve(img); };
    img.onerror = function() { reject(new Error('Failed to load image')); };
    img.src = src;
  });
}

// ─── Message handler (called by injectJavaScript from RN) ────────────────────
window.handleMessage = function(msgStr) {
  var data;
  try { data = JSON.parse(msgStr); } catch(e) { return; }

  if (data.type === 'detect') {
    loadImage(data.imageBase64).then(function(img) {
      var corners = detectDocumentCorners(img);
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'detected',
        corners: corners,
        imageWidth: img.width,
        imageHeight: img.height,
      }));
    }).catch(function(e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: e.message }));
    });

  } else if (data.type === 'process') {
    loadImage(data.imageBase64).then(function(img) {
      var canvas = perspectiveTransform(img, data.corners);
      canvas = applyScanFilter(canvas, data.filter, data.brightness, data.contrast);

      // ─── Place on A4 canvas (white bg, centered, contain) ────────────
      var A4_W = 2100, A4_H = 2970; // A4 at 254 DPI (print quality)
      var a4Canvas = document.createElement('canvas');
      a4Canvas.width = A4_W; a4Canvas.height = A4_H;
      var a4Ctx = a4Canvas.getContext('2d');
      a4Ctx.fillStyle = '#ffffff';
      a4Ctx.fillRect(0, 0, A4_W, A4_H);

      // Fit content inside A4 with padding
      var PAD = 40; // pixels padding
      var maxCW = A4_W - PAD * 2, maxCH = A4_H - PAD * 2;
      var scale = Math.min(maxCW / canvas.width, maxCH / canvas.height);
      var drawW = Math.round(canvas.width * scale);
      var drawH = Math.round(canvas.height * scale);
      var drawX = Math.round((A4_W - drawW) / 2);
      var drawY = Math.round((A4_H - drawH) / 2);
      a4Ctx.drawImage(canvas, drawX, drawY, drawW, drawH);

      // Thumbnail
      var tw = 480;
      var th = Math.round(480 * A4_H / A4_W);
      var thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = tw; thumbCanvas.height = th;
      thumbCanvas.getContext('2d').drawImage(a4Canvas, 0, 0, tw, th);

      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'processed',
        processed: a4Canvas.toDataURL('image/jpeg', 0.92),
        thumb: thumbCanvas.toDataURL('image/jpeg', 0.5),
      }));
    }).catch(function(e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: e.message }));
    });
  }
};
</script>
</body>
</html>`;
