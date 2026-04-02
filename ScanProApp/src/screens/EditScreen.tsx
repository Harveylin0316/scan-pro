import React, {
  useRef, useState, useCallback, useEffect, useMemo,
} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ActivityIndicator, SafeAreaView, ScrollView, Alert, Dimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Slider from '@react-native-community/slider';
import * as FileSystem from 'expo-file-system/legacy';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import ImageProcessor, { ImageProcessorRef } from '../components/ImageProcessor';
import { useScanStore, Corner, Filter } from '../store/scanStore';
import { RootStackParamList } from '../../App';

type Nav   = NativeStackNavigationProp<RootStackParamList, 'Edit'>;
type Route = RouteProp<RootStackParamList, 'Edit'>;

const { width: SCREEN_W } = Dimensions.get('window');
const HANDLE_R = 18;       // corner handle radius
const EDGE_HANDLE_R = 12;  // edge midpoint handle size (half-width)
const HANDLE_HIT = 50;     // hit-test radius

type ImageLayout = {
  containerW: number; containerH: number;
  displayW: number;   displayH: number;
  offsetX: number;    offsetY: number;
};

type Pt = { x: number; y: number };

function n2s(c: Corner, l: ImageLayout): Pt {
  return { x: l.offsetX + c.x * l.displayW, y: l.offsetY + c.y * l.displayH };
}
function s2n(sx: number, sy: number, l: ImageLayout): Corner {
  return {
    x: Math.max(0, Math.min(1, (sx - l.offsetX) / l.displayW)),
    y: Math.max(0, Math.min(1, (sy - l.offsetY) / l.displayH)),
  };
}
function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Point-in-quadrilateral (cross product method)
function pointInQuad(p: Pt, quad: Pt[]): boolean {
  for (let i = 0; i < 4; i++) {
    const a = quad[i], b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross < 0) return false;
  }
  return true;
}

const FALLBACK_CORNERS: Corner[] = [
  { x: 0.08, y: 0.08 }, { x: 0.92, y: 0.08 },
  { x: 0.92, y: 0.92 }, { x: 0.08, y: 0.92 },
];

function getA4Corners(imgW: number, imgH: number): Corner[] {
  const A4_RATIO = 210 / 297;
  const PAD = 0.04;
  const maxW = 1 - PAD * 2, maxH = 1 - PAD * 2;
  const target = A4_RATIO * (imgH / imgW);
  let cropW: number, cropH: number;
  if (target <= 1) {
    cropH = maxH; cropW = cropH * target;
    if (cropW > maxW) { cropW = maxW; cropH = cropW / target; }
  } else {
    cropW = maxW; cropH = cropW / target;
    if (cropH > maxH) { cropH = maxH; cropW = cropH * target; }
  }
  const x1 = (1 - cropW) / 2, y1 = (1 - cropH) / 2;
  return [
    { x: x1, y: y1 }, { x: x1 + cropW, y: y1 },
    { x: x1 + cropW, y: y1 + cropH }, { x: x1, y: y1 + cropH },
  ];
}

// Handle indices:
//   0=TL corner, 1=Top edge mid, 2=TR corner,
//   3=Right edge mid, 4=BR corner, 5=Bottom edge mid,
//   6=BL corner, 7=Left edge mid
// Special: -2 = drag whole rectangle
const CORNER_MAP = [0, -1, 1, -1, 2, -1, 3, -1]; // handle idx → corner idx (-1 = edge)

function getHandlePositions(corners: Corner[], layout: ImageLayout): Pt[] {
  const p = corners.map(c => n2s(c, layout));
  return [
    p[0],          mid(p[0], p[1]), p[1],
    mid(p[1], p[2]), p[2],          mid(p[2], p[3]),
    p[3],          mid(p[3], p[0]),
  ];
}

type Step = 'crop' | 'adjust';

export default function EditScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { uri, pageId } = route.params;

  const processorRef = useRef<ImageProcessorRef>(null);
  const { pages, addPage, updatePage } = useScanStore();
  const existingPage = pageId ? pages.find((p) => p.id === pageId) : undefined;

  const [step, setStep] = useState<Step>('crop');

  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [containerDims, setContainerDims] = useState<{ w: number; h: number } | null>(null);

  const layout = useMemo<ImageLayout | null>(() => {
    if (!imgSize || !containerDims) return null;
    const scale = Math.min(containerDims.w / imgSize.w, containerDims.h / imgSize.h);
    const dW = imgSize.w * scale, dH = imgSize.h * scale;
    return {
      containerW: containerDims.w, containerH: containerDims.h,
      displayW: dW, displayH: dH,
      offsetX: (containerDims.w - dW) / 2, offsetY: (containerDims.h - dH) / 2,
    };
  }, [imgSize, containerDims]);

  const a4Corners = imgSize ? getA4Corners(imgSize.w, imgSize.h) : FALLBACK_CORNERS;
  const [corners, setCorners]       = useState<Corner[]>(existingPage?.corners ?? FALLBACK_CORNERS);
  const a4InitDone = useRef(false);
  const [filter, setFilter]         = useState<Filter>(existingPage?.filter ?? 'scan');
  const [brightness, setBrightness] = useState(existingPage?.brightness ?? 0);
  const [contrast, setContrast]     = useState(existingPage?.contrast ?? 0);

  const [processing, setProcessing]         = useState(false);
  const [processorReady, setProcessorReady] = useState(false);

  const imageBase64Ref = useRef<string | null>(null);
  const readImageBase64 = useCallback(async () => {
    if (imageBase64Ref.current) return imageBase64Ref.current;
    const raw = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const dataUrl = `data:image/jpeg;base64,${raw}`;
    imageBase64Ref.current = dataUrl;
    return dataUrl;
  }, [uri]);

  useEffect(() => {
    Image.getSize(uri, (w, h) => setImgSize({ w, h }), () => setImgSize({ w: 1, h: 1 }));
  }, [uri]);

  useEffect(() => {
    if (imgSize && !existingPage && !a4InitDone.current) {
      a4InitDone.current = true;
      setCorners(getA4Corners(imgSize.w, imgSize.h));
    }
  }, [imgSize, existingPage]);

  const onContainerLayout = useCallback((e: any) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerDims({ w: width, h: height });
  }, []);

  // ── Gesture ──────────────────────────────────────────────────────────────────
  const cornersRef = useRef(corners);   cornersRef.current = corners;
  const layoutRef  = useRef(layout);    layoutRef.current  = layout;
  const activeIdx  = useRef(-1);        // handle idx or -2 for whole drag
  const startCornersRef = useRef<Corner[]>([]);

  const updateDrag = useCallback((tx: number, ty: number) => {
    const lay = layoutRef.current;
    const idx = activeIdx.current;
    if (!lay || idx === -1) return;

    const sc = startCornersRef.current;
    if (sc.length !== 4) return;

    setCorners(() => {
      const next = [...sc];

      if (idx === -2) {
        // Whole rectangle drag: move all 4 corners
        const dx = tx / lay.displayW;
        const dy = ty / lay.displayH;
        return next.map(c => ({
          x: Math.max(0, Math.min(1, c.x + dx)),
          y: Math.max(0, Math.min(1, c.y + dy)),
        }));
      }

      const cornerIdx = CORNER_MAP[idx];
      if (cornerIdx >= 0) {
        // Corner handle: move single corner
        const ref = n2s(sc[cornerIdx], lay);
        next[cornerIdx] = s2n(ref.x + tx, ref.y + ty, lay);
      } else {
        // Edge midpoint handle
        if (idx === 1) {
          // Top edge: move corners 0,1 Y
          const r0 = n2s(sc[0], lay), r1 = n2s(sc[1], lay);
          next[0] = s2n(r0.x, r0.y + ty, lay);
          next[1] = s2n(r1.x, r1.y + ty, lay);
        } else if (idx === 3) {
          // Right edge: move corners 1,2 X
          const r1 = n2s(sc[1], lay), r2 = n2s(sc[2], lay);
          next[1] = s2n(r1.x + tx, r1.y, lay);
          next[2] = s2n(r2.x + tx, r2.y, lay);
        } else if (idx === 5) {
          // Bottom edge: move corners 2,3 Y
          const r2 = n2s(sc[2], lay), r3 = n2s(sc[3], lay);
          next[2] = s2n(r2.x, r2.y + ty, lay);
          next[3] = s2n(r3.x, r3.y + ty, lay);
        } else if (idx === 7) {
          // Left edge: move corners 3,0 X
          const r3 = n2s(sc[3], lay), r0 = n2s(sc[0], lay);
          next[3] = s2n(r3.x + tx, r3.y, lay);
          next[0] = s2n(r0.x + tx, r0.y, lay);
        }
      }
      return next;
    });
  }, []);

  const panGesture = useMemo(() =>
    Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .onBegin((e) => {
        const lay = layoutRef.current;
        if (!lay) return;
        const cs = cornersRef.current;
        const touch: Pt = { x: e.x, y: e.y };

        // Compute 8 handle positions
        const handles = getHandlePositions(cs, lay);

        // Hit-test: corners first (even indices), then edges (odd indices)
        let best = -1, bestDist = 99999;
        // Pass 1: corners
        for (const i of [0, 2, 4, 6]) {
          const d = Math.hypot(touch.x - handles[i].x, touch.y - handles[i].y);
          if (d < HANDLE_HIT && d < bestDist) { bestDist = d; best = i; }
        }
        // Pass 2: edges (only if no corner hit)
        if (best === -1) {
          for (const i of [1, 3, 5, 7]) {
            const d = Math.hypot(touch.x - handles[i].x, touch.y - handles[i].y);
            if (d < HANDLE_HIT && d < bestDist) { bestDist = d; best = i; }
          }
        }
        // Pass 3: inside quad → whole drag
        if (best === -1) {
          const quad = cs.map(c => n2s(c, lay));
          if (pointInQuad(touch, quad)) best = -2;
        }

        activeIdx.current = best;
        startCornersRef.current = [...cs];
      })
      .onUpdate((e) => {
        if (activeIdx.current !== -1) {
          updateDrag(e.translationX, e.translationY);
        }
      })
      .onFinalize(() => { activeIdx.current = -1; }),
  [updateDrag]);

  // ── Confirm ──────────────────────────────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    if (!processorReady) return;
    try {
      setProcessing(true);
      const dataUrl = await readImageBase64();
      const result = await processorRef.current!.process(
        dataUrl, corners, filter, brightness, contrast,
      );
      if (existingPage) {
        updatePage(existingPage.id, {
          processedBase64: result.processed, thumbBase64: result.thumb,
          corners, filter, brightness, contrast,
        });
      } else {
        addPage({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          originalUri: uri,
          processedBase64: result.processed, thumbBase64: result.thumb,
          corners, filter, brightness, contrast,
        });
      }
      navigation.navigate('Home');
    } catch (e: any) {
      Alert.alert('處理失敗', e.message);
    } finally {
      setProcessing(false);
    }
  }, [processorReady, readImageBase64, corners, filter, brightness, contrast, existingPage, addPage, updatePage, navigation, uri]);

  // ── Render helpers ───────────────────────────────────────────────────────────
  const renderHandles = () => {
    if (!layout) return null;
    const handles = getHandlePositions(corners, layout);
    return handles.map((p, i) => {
      const isCorner = i % 2 === 0;
      const r = isCorner ? HANDLE_R : EDGE_HANDLE_R;
      return (
        <View
          key={`h${i}`}
          style={[
            isCorner ? styles.cornerHandle : styles.edgeHandle,
            { left: p.x - r, top: p.y - r },
          ]}
        />
      );
    });
  };

  const renderCropLines = () => {
    if (!layout) return null;
    const pts = corners.map(c => n2s(c, layout));

    // Border lines
    const borders = [[0,1],[1,2],[2,3],[3,0]].map(([a,b], i) => {
      const dx = pts[b].x - pts[a].x, dy = pts[b].y - pts[a].y;
      const len = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      return (
        <View key={`b${i}`} style={[styles.cropLine, {
          left: (pts[a].x + pts[b].x) / 2 - len / 2,
          top: (pts[a].y + pts[b].y) / 2 - 1,
          width: len,
          transform: [{ rotate: `${angle}deg` }],
        }]} />
      );
    });

    // Grid lines (1/3 and 2/3)
    const gridLines: React.ReactNode[] = [];
    for (const t of [1/3, 2/3]) {
      // Horizontal: lerp between left edge and right edge
      const hLeft  = lerp(pts[0], pts[3], t);
      const hRight = lerp(pts[1], pts[2], t);
      const hdx = hRight.x - hLeft.x, hdy = hRight.y - hLeft.y;
      const hLen = Math.hypot(hdx, hdy);
      const hAngle = Math.atan2(hdy, hdx) * 180 / Math.PI;
      gridLines.push(
        <View key={`gh${t}`} style={[styles.gridLine, {
          left: (hLeft.x + hRight.x) / 2 - hLen / 2,
          top: (hLeft.y + hRight.y) / 2 - 0.5,
          width: hLen,
          transform: [{ rotate: `${hAngle}deg` }],
        }]} />
      );

      // Vertical: lerp between top edge and bottom edge
      const vTop    = lerp(pts[0], pts[1], t);
      const vBottom = lerp(pts[3], pts[2], t);
      const vdx = vBottom.x - vTop.x, vdy = vBottom.y - vTop.y;
      const vLen = Math.hypot(vdx, vdy);
      const vAngle = Math.atan2(vdy, vdx) * 180 / Math.PI;
      gridLines.push(
        <View key={`gv${t}`} style={[styles.gridLine, {
          left: (vTop.x + vBottom.x) / 2 - vLen / 2,
          top: (vTop.y + vBottom.y) / 2 - 0.5,
          width: vLen,
          transform: [{ rotate: `${vAngle}deg` }],
        }]} />
      );
    }

    return [...borders, ...gridLines];
  };

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'scan',  label: '📄 掃描' },
    { key: 'bw',    label: '⬛ 黑白' },
    { key: 'gray',  label: '🔘 灰階' },
    { key: 'color', label: '🎨 原色' },
  ];

  // ════════════════════════════════════════════════════════════════════════════
  //  STEP 1: CROP
  // ════════════════════════════════════════════════════════════════════════════
  if (step === 'crop') {
    return (
      <SafeAreaView style={styles.safeDark}>
        <ImageProcessor ref={processorRef} onReady={() => setProcessorReady(true)} />

        <View style={styles.headerDark}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>取消</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitleLight}>裁切</Text>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setStep('adjust')}>
            <Text style={styles.headerBtnAccent}>下一步</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.cropArea} onLayout={onContainerLayout}>
          <Image source={{ uri }} style={styles.cropImage} resizeMode="contain" />
          {layout && (
            <GestureDetector gesture={panGesture}>
              <View style={StyleSheet.absoluteFill}>
                {renderCropLines()}
                {renderHandles()}
              </View>
            </GestureDetector>
          )}
        </View>

        <View style={styles.cropToolbar}>
          <TouchableOpacity style={styles.toolbarBtn} onPress={() => setCorners(a4Corners)}>
            <Text style={styles.toolbarBtnText}>重設裁切</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  STEP 2: ADJUST
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={styles.safe}>
      <ImageProcessor ref={processorRef} onReady={() => setProcessorReady(true)} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => setStep('crop')} style={styles.headerBtn}>
          <Text style={styles.backText}>← 裁切</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>調整</Text>
        <TouchableOpacity
          style={[styles.confirmBtn, (!processorReady || processing) && styles.confirmBtnDisabled]}
          onPress={handleConfirm}
          disabled={!processorReady || processing}
        >
          {processing
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.confirmBtnText}>確認</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.previewContainer}>
          <Image source={{ uri }} style={styles.previewImage} resizeMode="contain" />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>掃描模式</Text>
          <View style={styles.filterRow}>
            {FILTERS.map(f => (
              <TouchableOpacity
                key={f.key}
                style={[styles.filterBtn, filter === f.key && styles.filterBtnActive]}
                onPress={() => setFilter(f.key)}
              >
                <Text style={[styles.filterBtnText, filter === f.key && styles.filterBtnTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>亮度</Text>
            <Text style={styles.sliderValue}>{brightness}</Text>
          </View>
          <Slider
            minimumValue={-50} maximumValue={50} step={1}
            value={brightness} onValueChange={setBrightness}
            minimumTrackTintColor="#2563eb" maximumTrackTintColor="#e5e7eb" thumbTintColor="#2563eb"
          />
          <View style={[styles.sliderRow, { marginTop: 14 }]}>
            <Text style={styles.sliderLabel}>對比度</Text>
            <Text style={styles.sliderValue}>{contrast}</Text>
          </View>
          <Slider
            minimumValue={-50} maximumValue={50} step={1}
            value={contrast} onValueChange={setContrast}
            minimumTrackTintColor="#2563eb" maximumTrackTintColor="#e5e7eb" thumbTintColor="#2563eb"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeDark: { flex: 1, backgroundColor: '#111827' },
  headerDark: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#374151',
  },
  headerTitleLight: { fontSize: 17, fontWeight: '600', color: '#fff' },
  headerBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  headerBtnText: { fontSize: 15, color: '#9ca3af' },
  headerBtnAccent: { fontSize: 15, fontWeight: '600', color: '#60a5fa' },

  cropArea: { flex: 1, backgroundColor: '#111827' },
  cropImage: { width: '100%', height: '100%' },

  cornerHandle: {
    position: 'absolute',
    width: HANDLE_R * 2, height: HANDLE_R * 2, borderRadius: HANDLE_R,
    backgroundColor: '#2563eb', borderWidth: 3, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6, shadowRadius: 4, elevation: 5,
  },
  edgeHandle: {
    position: 'absolute',
    width: EDGE_HANDLE_R * 2, height: EDGE_HANDLE_R * 2, borderRadius: 4,
    backgroundColor: '#fff', borderWidth: 2, borderColor: '#2563eb',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4, shadowRadius: 3, elevation: 3,
  },
  cropLine: {
    position: 'absolute', height: 2, backgroundColor: '#60a5fa', opacity: 0.9,
  },
  gridLine: {
    position: 'absolute', height: 1, backgroundColor: 'rgba(255,255,255,0.35)',
  },

  detectingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  detectingTextLight: { fontSize: 15, color: '#d1d5db' },

  cropToolbar: {
    flexDirection: 'row', justifyContent: 'center',
    paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#374151',
  },
  toolbarBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
    backgroundColor: '#1f2937', borderWidth: 1, borderColor: '#4b5563',
  },
  toolbarBtnText: { color: '#d1d5db', fontSize: 14, fontWeight: '500' },

  safe: { flex: 1, backgroundColor: '#f9fafb' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#111827' },
  backText: { fontSize: 15, color: '#2563eb' },
  confirmBtn: {
    backgroundColor: '#2563eb', paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 8, minWidth: 70, alignItems: 'center',
  },
  confirmBtnDisabled: { backgroundColor: '#93c5fd' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  previewContainer: {
    height: 240, backgroundColor: '#1f2937',
    justifyContent: 'center', alignItems: 'center',
  },
  previewImage: { width: '100%', height: '100%' },

  section: {
    backgroundColor: '#fff', marginTop: 12, marginHorizontal: 16,
    borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#6b7280', marginBottom: 10 },

  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff',
  },
  filterBtnActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  filterBtnText: { fontSize: 13, color: '#6b7280' },
  filterBtnTextActive: { color: '#fff' },

  sliderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  sliderLabel: { fontSize: 13, color: '#374151' },
  sliderValue: { fontSize: 13, color: '#6b7280' },
});
