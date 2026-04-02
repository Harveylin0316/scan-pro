import React, {
  useRef, useState, useCallback, useEffect, useMemo,
} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  PanResponder, ActivityIndicator, SafeAreaView,
  ScrollView, Alert, Dimensions,
} from 'react-native';
import Slider from '@react-native-community/slider';
import * as FileSystem from 'expo-file-system/legacy';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import ImageProcessor, { ImageProcessorRef } from '../components/ImageProcessor';
import { useScanStore, Corner, Filter } from '../store/scanStore';
import { RootStackParamList } from '../../App';

type Nav  = NativeStackNavigationProp<RootStackParamList, 'Edit'>;
type Route = RouteProp<RootStackParamList, 'Edit'>;

const SCREEN_W = Dimensions.get('window').width;
const HANDLE_R = 18; // handle radius

type ImageLayout = {
  containerW: number;
  containerH: number;
  displayW: number;
  displayH: number;
  offsetX: number;
  offsetY: number;
};

function normalizedToScreen(c: Corner, layout: ImageLayout) {
  return {
    x: layout.offsetX + c.x * layout.displayW,
    y: layout.offsetY + c.y * layout.displayH,
  };
}

function screenToNormalized(sx: number, sy: number, layout: ImageLayout): Corner {
  return {
    x: Math.max(0, Math.min(1, (sx - layout.offsetX) / layout.displayW)),
    y: Math.max(0, Math.min(1, (sy - layout.offsetY) / layout.displayH)),
  };
}

const DEFAULT_CORNERS: Corner[] = [
  { x: 0.08, y: 0.08 },
  { x: 0.92, y: 0.08 },
  { x: 0.92, y: 0.92 },
  { x: 0.08, y: 0.92 },
];

export default function EditScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { uri, pageId } = route.params;

  const processorRef = useRef<ImageProcessorRef>(null);
  const { pages, addPage, updatePage } = useScanStore();

  const existingPage = pageId ? pages.find((p) => p.id === pageId) : undefined;

  // Image metadata
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [layout, setLayout] = useState<ImageLayout | null>(null);

  // Editing state
  const [corners, setCorners]     = useState<Corner[]>(existingPage?.corners ?? DEFAULT_CORNERS);
  const [filter, setFilter]       = useState<Filter>(existingPage?.filter ?? 'scan');
  const [brightness, setBrightness] = useState(existingPage?.brightness ?? 0);
  const [contrast, setContrast]   = useState(existingPage?.contrast ?? 0);

  // UI state
  const [detecting, setDetecting] = useState(!existingPage);
  const [processing, setProcessing] = useState(false);
  const [processorReady, setProcessorReady] = useState(false);

  // ── Load image size ──────────────────────────────────────────────────────────
  useEffect(() => {
    Image.getSize(
      uri,
      (w, h) => setImgSize({ w, h }),
      () => setImgSize({ w: 1, h: 1 })
    );
  }, [uri]);

  // ── Auto-detect corners when processor ready ─────────────────────────────────
  const runDetect = useCallback(async () => {
    if (!processorReady || existingPage) return;
    try {
      setDetecting(true);
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const dataUrl = `data:image/jpeg;base64,${base64}`;
      const result = await processorRef.current!.detect(dataUrl);
      setCorners(result.corners);
    } catch {
      // keep default corners on failure
    } finally {
      setDetecting(false);
    }
  }, [processorReady, existingPage, uri]);

  useEffect(() => { runDetect(); }, [runDetect]);

  // ── Compute image layout inside container ────────────────────────────────────
  const onContainerLayout = useCallback((e: any) => {
    if (!imgSize) return;
    const { width: cW, height: cH } = e.nativeEvent.layout;
    const scale = Math.min(cW / imgSize.w, cH / imgSize.h);
    const dW = imgSize.w * scale;
    const dH = imgSize.h * scale;
    setLayout({
      containerW: cW, containerH: cH,
      displayW: dW, displayH: dH,
      offsetX: (cW - dW) / 2,
      offsetY: (cH - dH) / 2,
    });
  }, [imgSize]);

  // ── Pan responders for corner handles ────────────────────────────────────────
  const panResponders = useMemo(() => {
    return corners.map((_, idx) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_, gs) => {
          if (!layout) return;
          setCorners((prev) => {
            const next = [...prev];
            const ref = normalizedToScreen(prev[idx], layout);
            const newX = ref.x + gs.dx;
            const newY = ref.y + gs.dy;
            next[idx] = screenToNormalized(newX, newY, layout);
            return next;
          });
        },
      })
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, corners.length]);

  // ── Confirm ──────────────────────────────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    if (!processorReady) return;
    try {
      setProcessing(true);
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const dataUrl = `data:image/jpeg;base64,${base64}`;
      const result = await processorRef.current!.process(
        dataUrl, corners, filter, brightness, contrast
      );

      if (existingPage) {
        updatePage(existingPage.id, {
          processedBase64: result.processed,
          thumbBase64: result.thumb,
          corners, filter, brightness, contrast,
        });
      } else {
        addPage({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          originalUri: uri,
          processedBase64: result.processed,
          thumbBase64: result.thumb,
          corners, filter, brightness, contrast,
        });
      }
      navigation.navigate('Home');
    } catch (e: any) {
      Alert.alert('處理失敗', e.message);
    } finally {
      setProcessing(false);
    }
  }, [processorReady, uri, corners, filter, brightness, contrast, existingPage, addPage, updatePage, navigation]);

  // ── Reset corners ─────────────────────────────────────────────────────────────
  const handleResetCorners = useCallback(() => {
    setCorners(DEFAULT_CORNERS);
  }, []);

  // ── Render corner handles ─────────────────────────────────────────────────────
  const renderHandles = () => {
    if (!layout) return null;
    return corners.map((c, idx) => {
      const pos = normalizedToScreen(c, layout);
      return (
        <View
          key={idx}
          style={[styles.handle, { left: pos.x - HANDLE_R, top: pos.y - HANDLE_R }]}
          {...panResponders[idx].panHandlers}
        />
      );
    });
  };

  // ── Render crop lines ─────────────────────────────────────────────────────────
  const renderLines = () => {
    if (!layout) return null;
    const pts = corners.map((c) => normalizedToScreen(c, layout));
    const lines = [
      { x1: pts[0].x, y1: pts[0].y, x2: pts[1].x, y2: pts[1].y },
      { x1: pts[1].x, y1: pts[1].y, x2: pts[2].x, y2: pts[2].y },
      { x1: pts[2].x, y1: pts[2].y, x2: pts[3].x, y2: pts[3].y },
      { x1: pts[3].x, y1: pts[3].y, x2: pts[0].x, y2: pts[0].y },
    ];
    return lines.map((l, i) => {
      const dx = l.x2 - l.x1;
      const dy = l.y2 - l.y1;
      const len = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      return (
        <View
          key={i}
          style={[
            styles.cropLine,
            {
              left: l.x1,
              top: l.y1,
              width: len,
              transform: [{ rotate: `${angle}deg` }],
            },
          ]}
        />
      );
    });
  };

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'scan', label: '📄 掃描' },
    { key: 'bw',   label: '⬛ 黑白' },
    { key: 'gray', label: '🔘 灰階' },
    { key: 'color',label: '🎨 原色' },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      {/* Hidden processor WebView */}
      <ImageProcessor
        ref={processorRef}
        onReady={() => setProcessorReady(true)}
      />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {existingPage ? '編輯頁面' : '新增掃描頁'}
        </Text>
        <TouchableOpacity
          style={[styles.confirmBtn, (!processorReady || processing) && styles.confirmBtnDisabled]}
          onPress={handleConfirm}
          disabled={!processorReady || processing}
        >
          {processing
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.confirmBtnText}>✓ 確認</Text>
          }
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Image + crop overlay */}
        <View style={styles.imageContainer} onLayout={onContainerLayout}>
          <Image
            source={{ uri }}
            style={styles.image}
            resizeMode="contain"
          />
          {layout && (
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
              {renderLines()}
              {(detecting || !layout) ? null : renderHandles()}
            </View>
          )}
          {detecting && (
            <View style={styles.detectingOverlay}>
              <ActivityIndicator color="#2563eb" size="large" />
              <Text style={styles.detectingText}>偵測文件邊緣...</Text>
            </View>
          )}
        </View>

        {/* Reset corners */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.resetBtn} onPress={handleResetCorners}>
            <Text style={styles.resetBtnText}>重設裁切</Text>
          </TouchableOpacity>
        </View>

        {/* Filter */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>掃描模式</Text>
          <View style={styles.filterRow}>
            {FILTERS.map((f) => (
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

        {/* Sliders */}
        <View style={styles.section}>
          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>亮度</Text>
            <Text style={styles.sliderValue}>{brightness}</Text>
          </View>
          <Slider
            minimumValue={-50} maximumValue={50} step={1}
            value={brightness}
            onValueChange={setBrightness}
            minimumTrackTintColor="#2563eb"
            maximumTrackTintColor="#e5e7eb"
            thumbTintColor="#2563eb"
          />
          <View style={[styles.sliderRow, { marginTop: 12 }]}>
            <Text style={styles.sliderLabel}>對比度</Text>
            <Text style={styles.sliderValue}>{contrast}</Text>
          </View>
          <Slider
            minimumValue={-50} maximumValue={50} step={1}
            value={contrast}
            onValueChange={setContrast}
            minimumTrackTintColor="#2563eb"
            maximumTrackTintColor="#e5e7eb"
            thumbTintColor="#2563eb"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f9fafb' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  backBtn: { paddingHorizontal: 4 },
  backBtnText: { fontSize: 15, color: '#2563eb' },
  headerTitle: { fontSize: 16, fontWeight: '600', color: '#111827' },
  confirmBtn: {
    backgroundColor: '#2563eb', paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 8, minWidth: 70, alignItems: 'center',
  },
  confirmBtnDisabled: { backgroundColor: '#93c5fd' },
  confirmBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 32 },

  imageContainer: {
    width: SCREEN_W, height: SCREEN_W * 1.3,
    backgroundColor: '#1f2937',
    justifyContent: 'center', alignItems: 'center',
  },
  image: { width: '100%', height: '100%' },

  handle: {
    position: 'absolute',
    width: HANDLE_R * 2, height: HANDLE_R * 2, borderRadius: HANDLE_R,
    backgroundColor: '#2563eb',
    borderWidth: 3, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4, shadowRadius: 4, elevation: 5,
  },
  cropLine: {
    position: 'absolute',
    height: 2, backgroundColor: '#2563eb',
    transformOrigin: 'left center',
    opacity: 0.8,
  },

  detectingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  detectingText: { fontSize: 15, color: '#374151' },

  section: {
    backgroundColor: '#fff', marginTop: 12, marginHorizontal: 16,
    borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#6b7280', marginBottom: 10 },

  resetBtn: {
    alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 8, backgroundColor: '#f3f4f6',
    borderWidth: 1, borderColor: '#d1d5db',
  },
  resetBtnText: { fontSize: 14, color: '#374151', fontWeight: '500' },

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
