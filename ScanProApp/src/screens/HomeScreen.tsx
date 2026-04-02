import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, Alert, ActivityIndicator, SafeAreaView, StatusBar,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useScanStore, ScanPage } from '../store/scanStore';
import { exportToPdf, exportImages } from '../utils/pdfExport';
import { RootStackParamList } from '../../App';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { pages, removePage, movePageUp, movePageDown, clearPages } = useScanStore();
  const [exporting, setExporting] = useState<'pdf' | 'img' | null>(null);

  const handleExportPdf = useCallback(async () => {
    try {
      setExporting('pdf');
      await exportToPdf(pages);
      Alert.alert('輸出成功', `PDF 已匯出（${pages.length} 頁）`);
    } catch (e: any) {
      Alert.alert('輸出失敗', e.message);
    } finally {
      setExporting(null);
    }
  }, [pages]);

  const handleExportImages = useCallback(async () => {
    try {
      setExporting('img');
      const count = await exportImages(pages);
      Alert.alert('已儲存到相簿', `${count} 張圖片已存入你的相簿`);
    } catch (e: any) {
      Alert.alert('輸出失敗', e.message);
    } finally {
      setExporting(null);
    }
  }, [pages]);

  const handleDelete = useCallback((id: string) => {
    Alert.alert('刪除頁面', '確定要刪除這一頁？', [
      { text: '取消', style: 'cancel' },
      { text: '刪除', style: 'destructive', onPress: () => removePage(id) },
    ]);
  }, [removePage]);

  const handleClearAll = useCallback(() => {
    if (pages.length === 0) return;
    Alert.alert('清除全部', '確定要清除所有頁面？', [
      { text: '取消', style: 'cancel' },
      { text: '清除', style: 'destructive', onPress: clearPages },
    ]);
  }, [pages.length, clearPages]);

  // 直接從首頁選圖片
  const handlePickImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('需要相簿權限', '請在設定中允許存取相簿');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.92,
      allowsMultipleSelection: false,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      navigation.navigate('Edit', { uri: result.assets[0].uri, pageId: undefined });
    }
  }, [navigation]);

  const renderPage = useCallback(({ item, index }: { item: ScanPage; index: number }) => (
    <View style={styles.pageCard}>
      {/* Large preview */}
      <TouchableOpacity
        onPress={() => navigation.navigate('Edit', { uri: item.originalUri, pageId: item.id })}
        activeOpacity={0.8}
      >
        <Image
          source={{ uri: item.thumbBase64 }}
          style={styles.pagePreview}
          resizeMode="contain"
        />
      </TouchableOpacity>

      {/* Bottom info + actions */}
      <View style={styles.pageBottom}>
        <View style={styles.pageInfo}>
          <Text style={styles.pageNum}>第 {index + 1} 頁</Text>
          <Text style={styles.filterLabel}>{filterLabel(item.filter)}</Text>
        </View>

        <View style={styles.pageActions}>
          <TouchableOpacity
            style={[styles.iconBtn, index === 0 && styles.iconBtnDisabled]}
            onPress={() => movePageUp(item.id)}
            disabled={index === 0}
          >
            <Text style={styles.iconBtnText}>↑</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, index === pages.length - 1 && styles.iconBtnDisabled]}
            onPress={() => movePageDown(item.id)}
            disabled={index === pages.length - 1}
          >
            <Text style={styles.iconBtnText}>↓</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, styles.iconBtnDanger]}
            onPress={() => handleDelete(item.id)}
          >
            <Text style={[styles.iconBtnText, { color: '#ef4444' }]}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  ), [pages.length, movePageUp, movePageDown, handleDelete, navigation]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>ScanPro</Text>
        <View style={styles.headerRight}>
          <Text style={styles.pageCount}>{pages.length} 頁</Text>
          {pages.length > 0 && (
            <TouchableOpacity onPress={handleClearAll} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>全部清除</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Page List */}
      {pages.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📷</Text>
          <Text style={styles.emptyText}>還沒有掃描頁</Text>
          <Text style={styles.emptySubtext}>點擊下方按鈕開始掃描</Text>
        </View>
      ) : (
        <FlatList
          data={pages}
          keyExtractor={(item) => item.id}
          renderItem={renderPage}
          contentContainerStyle={styles.list}
        />
      )}

      {/* Bottom Actions */}
      <View style={styles.bottom}>
        {pages.length > 0 && (
          <View style={styles.exportRow}>
            <TouchableOpacity
              style={[styles.exportBtn, styles.exportBtnSecondary]}
              onPress={handleExportImages}
              disabled={exporting !== null}
            >
              {exporting === 'img'
                ? <ActivityIndicator color="#374151" />
                : <Text style={styles.exportBtnSecondaryText}>輸出圖檔</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.exportBtn, styles.exportBtnSuccess]}
              onPress={handleExportPdf}
              disabled={exporting !== null}
            >
              {exporting === 'pdf'
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.exportBtnSuccessText}>輸出 PDF</Text>}
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.addRow}>
          <TouchableOpacity
            style={[styles.addBtn, styles.addBtnSecondary]}
            onPress={handlePickImage}
          >
            <Text style={styles.addBtnSecondaryText}>📂 選擇圖片</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.addBtn, styles.addBtnPrimary]}
            onPress={() => navigation.navigate('Camera')}
          >
            <Text style={styles.addBtnPrimaryText}>📷 拍照掃描</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function filterLabel(filter: string) {
  return { scan: '📄 掃描', bw: '⬛ 黑白', gray: '🔘 灰階', color: '🎨 原色' }[filter] ?? '';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f9fafb' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pageCount: {
    fontSize: 13, color: '#6b7280', backgroundColor: '#f3f4f6',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden',
  },
  clearBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  clearBtnText: { fontSize: 13, color: '#ef4444' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyIcon: { fontSize: 56 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#374151' },
  emptySubtext: { fontSize: 14, color: '#9ca3af' },

  list: { padding: 16, gap: 16 },

  // Card-style page preview
  pageCard: {
    backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: '#e5e7eb',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 3, elevation: 2,
  },
  pagePreview: {
    width: '100%', height: 360,
    backgroundColor: '#f3f4f6',
  },
  pageBottom: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  pageInfo: { gap: 2 },
  pageNum: { fontSize: 15, fontWeight: '600', color: '#111827' },
  filterLabel: { fontSize: 13, color: '#6b7280' },
  pageActions: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 8, backgroundColor: '#f3f4f6',
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnDisabled: { opacity: 0.3 },
  iconBtnDanger: { backgroundColor: '#fef2f2' },
  iconBtnText: { fontSize: 16, color: '#374151' },

  bottom: {
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14, gap: 10,
    borderTopWidth: 1, borderTopColor: '#e5e7eb',
  },
  exportRow: { flexDirection: 'row', gap: 10 },
  exportBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  exportBtnSecondary: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#d1d5db' },
  exportBtnSecondaryText: { color: '#374151', fontSize: 14, fontWeight: '600' },
  exportBtnSuccess: { backgroundColor: '#22c55e' },
  exportBtnSuccessText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  addRow: { flexDirection: 'row', gap: 10 },
  addBtn: {
    flex: 1, paddingVertical: 16, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  addBtnPrimary: { backgroundColor: '#2563eb' },
  addBtnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  addBtnSecondary: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#d1d5db' },
  addBtnSecondaryText: { color: '#374151', fontSize: 16, fontWeight: '600' },
});
