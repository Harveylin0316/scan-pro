import React, { useRef, useImperativeHandle, useCallback } from 'react';
import { View } from 'react-native';
import WebView from 'react-native-webview';
import { PROCESSOR_HTML } from '../utils/processorHtml';
import { Corner } from '../store/scanStore';

export interface DetectResult {
  corners: Corner[];
  imageWidth: number;
  imageHeight: number;
}

export interface ProcessResult {
  processed: string;
  thumb: string;
}

export interface ImageProcessorRef {
  detect: (imageBase64: string) => Promise<DetectResult>;
  process: (
    imageBase64: string,
    corners: Corner[],
    filter: string,
    brightness: number,
    contrast: number
  ) => Promise<ProcessResult>;
}

type PendingOp = {
  resolve: (val: any) => void;
  reject: (err: Error) => void;
};

interface ImageProcessorProps {
  onReady?: () => void;
}

const ImageProcessor = React.forwardRef<ImageProcessorRef, ImageProcessorProps>(
  ({ onReady }, ref) => {
  const webviewRef = useRef<WebView>(null);
  const pendingRef = useRef<PendingOp | null>(null);

  useImperativeHandle(ref, () => ({
    detect(imageBase64) {
      return new Promise((resolve, reject) => {
        pendingRef.current = { resolve, reject };
        const msg = JSON.stringify({ type: 'detect', imageBase64 });
        webviewRef.current?.injectJavaScript(
          `window.handleMessage(${JSON.stringify(msg)}); true;`
        );
      });
    },

    process(imageBase64, corners, filter, brightness, contrast) {
      return new Promise((resolve, reject) => {
        pendingRef.current = { resolve, reject };
        const msg = JSON.stringify({ type: 'process', imageBase64, corners, filter, brightness, contrast });
        webviewRef.current?.injectJavaScript(
          `window.handleMessage(${JSON.stringify(msg)}); true;`
        );
      });
    },
  }));

  const onMessage = useCallback((e: any) => {
    if (!pendingRef.current) return;
    const { resolve, reject } = pendingRef.current;
    pendingRef.current = null;
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === 'error') {
        reject(new Error(data.message));
      } else {
        resolve(data);
      }
    } catch (err) {
      reject(err as Error);
    }
  }, []);

  return (
    <View style={{ width: 1, height: 1, position: 'absolute', opacity: 0, pointerEvents: 'none' }}>
      <WebView
        ref={webviewRef}
        source={{ html: PROCESSOR_HTML }}
        onMessage={onMessage}
        onLoadEnd={onReady}
        javaScriptEnabled
        originWhitelist={['*']}
        style={{ width: 1, height: 1 }}
      />
    </View>
  );
});

export default ImageProcessor;
