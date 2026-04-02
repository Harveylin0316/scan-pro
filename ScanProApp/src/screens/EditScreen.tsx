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
const HANDLE_R = 22;
const HANDLE_HIT = 55;

type ImageLayout = {
  containerW: number; containerH: number;
  displayW: number;   displayH: number;
  offsetX: number;    offsetY: number;
};

function n2s(c: Corner, l: ImageLayout) {
  return { x: l.offsetX + c.x * l.displayW, y: l.offsetY + c.y * l.displayH };
}
function s2n(sx: number, sy: number, l: ImageLayout): Corner {
  return {
    x: Math.max(0, Math.min(1, (sx - l.offsetX) / l.displayW)),
    y: Math.max(0, Math.min(1, (sy - l.offsetY) / l.displayH)),
  };
}

const DEFAULT_CORNERS: Corner[] = [
  { x: 0.08, y: 0.08 }, { x: 0.92, y: 0.08 },
  { x: 0.92, y: 0.92 }, { x: 0.08, y: 0.92 },
];

type Step = 'crop' | 'adjust';

export default function EditScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { uri, pageId } = route.params;

  const processorRef = useRef<ImageProcessorRef>(null);
  const { pages, addPage, updatePage } = useScanStore();
  const existingPage = pageId ? pages.find((p) => p.id === pageId) : undefined;

  const [step, setStep] = useState<Step>('crop');

  // Image size + layout
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [containerDims, setContainerDims] = useState<{ w: number; h: number } | null>(null);

  const layout = useMemo<ImageLayout | null>(() => {
    if (!imgSize || !containerDims) return null;
    const scale = Math.min(containerDims.w / imgSize.w, containerDims.h / imgSize.h);
    const dW = imgSize.w * scale;
    const dH = imgSize.h * scale;
    return {
      containerW: containerDims.w, containerH: containerDims.h,
      displayW: dW, displayH: dH,
      offsetX: (containerDims.w - dW) / 2, offsetY: (containerDims.h - dH) / 2,
    };
  }, [imgSize, containerDims]);

  // Editing state
  const [corners, setCorners]       = useState<Corner[]>(existingPage?.corners ?? DEFAULT_CORNERS);
  const [filter, setFilter]         = useState<Filter>(existingPage?.filter ?? 'scan');
  const [brightness, setBrightness] = useState(existingPage?.brightness ?? 0);
  const [contrast, setContrast]     = useState(existingPage?.contrast ?? 0);

  // UI state
  const [detecting, setDetecting]           = useState(!existingPage);
  const [processing, setProcessing]         = useState(false);
  const [processorReady, setProcessorReady] = useState(false);

  // Cached base64
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

  // Auto-detect corners
  const runDetect = useCallback(async () => {
    if (!processorReady || existingPage) return;
    try {
      setDetecting(true);
      const dataUrl = await readImageBase64();
      const result = await processorRef.current!.detect(dataUrl);
      setCorners(result.corners);
    } catch { /* keep defaults */ } finally {
      setDetecting(false);
    }
  }, [processorReady, existingPage, readImageBase64]);

  useEffect(() => { runDetect(); }, [runDetect]);

  const onContainerLayout = useCallback((e: any) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerDims({ w: width, h: height });
  }, []);

  // ── Gesture handler (react-native-gesture-handler) ───────────────────────────
  const cornersRef = useRef(corners);   cornersRef.current = corners;
  const layoutRef  = useRef(layout);    layoutRef.current  = layout;
  const activeIdx  = useRef(-1);
  const startCornerRef = useRef<Corner>({ x: 0, y: 0 });

  const updateCorner = useCallback((translationX: number, translationY: number) => {
    const lay = layoutRef.current;
    const idx = activeIdx.current;
    if (idx < 0 || !lay) return;
    const ref = n2s(startCornerRef.current, lay);
    setCorners(prev => {
      const next = [...prev];
      next[idx] = s2n(ref.x + translationX, ref.y + translationY, lay);
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
        const tx = e.x, ty = e.y;
        let best = -1, bestDist = 99999;
        const cs = cornersRef.current;
        for (let i = 0; i < cs.length; i++) {
          const p = n2s(cs[i], lay);
          const d = Math.sqrt((tx - p.x) ** 2 + (ty - p.y) ** 2);
          if (d < HANDLE_HIT && d < bestDist) { bestDist = d; best = i; }
        }
        activeIdx.current = best;
        if (best >= 0) startCornerRef.current = cs[best];
      })
      .onUpdate((e) => {
        if (activeIdx.current >= 0) {
          updateCorner(e.translationX, e.translationY);
        }
      })
      .onFinalize(() => {
        activeIdx.current = -1;
      }),
  [updateCorner]);

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
    return corners.map((c, i) => {
      const p = n2s(c, layout);
      return <View key={i} style={[styles.handle, { left: p.x - HANDLE_R, top: p.y - HANDLE_R }]} />;
    });
  };

  const renderLines = () => {
    if (!layout) return null;
    const pts = corners.map(c => n2s(c, layout));
    return [[0,1],[1,2],[2,3],[3,0]].map(([a,b], i) => {
      const dx = pts[b].x - pts[a].x, dy = pts[b].y - pts[a].y;
      const len = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      return (
        <View key={i} style={[styles.cropLine, {
          left: (pts[a].x + pts[b].x) / 2 - len / 2,
          top: (pts[a].y + pts[b].y) / 2 - 1,
          width: len,
          transform: [{ rotate: `${angle}deg` }],
        }]} />
      );
    });
  };

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'scan',  label: '📄 掃描' },
    { key: 'bw',    label: '⬛ 黑白' },
    { key: 'gray',  label: '🔘 灰階' },
    { key: 'color', label: '🎨 原色' },
  ];

  // ════════════════════════════════════════════════════════════════════════════
  //  STEP 1: CROP — dark full-screen, no scroll
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

          {layout && !detecting && (
            <GestureDetector gesture={panGesture}>
              <View style={StyleSheet.absoluteFill}>
                {renderLines()}
                {renderHandles()}
              </View>
            </GestureDetector>
          )}

          {detecting && (
            <View style={styles.detectingOverlay}>
              <ActivityIndicator color="#fff" size="large" />
              <Text style={styles.detectingTextLight}>偵測文件邊緣...</Text>
            </View>
          )}
        </View>

        <View style={styles.cropToolbar}>
          <TouchableOpacity style={styles.toolbarBtn} onPress={() => setCorners(DEFAULT_CORNERS)}>
            <Text style={styles.toolbarBtnText}>重設裁切</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  STEP 2: ADJUST — scrollable
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
  // Crop step (dark)
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

  handle: {
    position: 'absolute',
    width: HANDLE_R * 2, height: HANDLE_R * 2, borderRadius: HANDLE_R,
    backgroundColor: '#2563eb',
    borderWidth: 3, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6, shadowRadius: 4, elevation: 5,
  },
  cropLine: {
    position: 'absolute', height: 2, backgroundColor: '#60a5fa', opacity: 0.9,
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

  // Adjust step (light)
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
