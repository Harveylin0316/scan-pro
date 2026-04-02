import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, Alert, ActivityIndicator, SafeAreaView, StatusBar,
} from 'react-native';
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
    } catch (e: any) {
      Alert.alert('輸出失敗', e.message);
    } finally {
      setExporting(null);
    }
  }, [pages]);

  const handleExportImages = useCallback(async () => {
    try {
      setExporting('img');
      await exportImages(pages);
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

  const renderPage = useCallback(({ item, index }: { item: ScanPage; index: number }) => (
    <View style={styles.pageRow}>
      <TouchableOpacity
        onPress={() => navigation.navigate('Edit', { uri: item.originalUri, pageId: item.id })}
        activeOpacity={0.8}
      >
        <Image
          source={{ uri: item.thumbBase64 }}
          style={styles.thumb}
          resizeMode="cover"
        />
      </TouchableOpacity>

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
          <Text style={styles.iconBtnText}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  ), [pages.length, movePageUp, movePageDown, handleDelete, navigation]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>📄 ScanPro</Text>
        <View style={styles.headerRight}>
          <Text style={styles.pageCount}>{pages.length} 頁</Text>
          <TouchableOpacity onPress={handleClearAll} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>全部清除</Text>
          </TouchableOpacity>
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
        <View style={styles.exportRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary, pages.length === 0 && styles.btnDisabled]}
            onPress={handleExportImages}
            disabled={pages.length === 0 || exporting !== null}
          >
            {exporting === 'img'
              ? <ActivityIndicator color="#374151" />
              : <Text style={styles.btnSecondaryText}>🖼️ 輸出圖檔</Text>
            }
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSuccess, pages.length === 0 && styles.btnDisabled]}
            onPress={handleExportPdf}
            disabled={pages.length === 0 || exporting !== null}
          >
            {exporting === 'pdf'
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnSuccessText}>📥 輸出 PDF</Text>
            }
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary]}
          onPress={() => navigation.navigate('Camera')}
        >
          <Text style={styles.btnPrimaryText}>+ 新增掃描頁</Text>
        </TouchableOpacity>
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
    backgroundColor: '#fff', paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pageCount: {
    fontSize: 13, color: '#6b7280', backgroundColor: '#f3f4f6',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  clearBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  clearBtnText: { fontSize: 13, color: '#6b7280' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyIcon: { fontSize: 56 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#374151' },
  emptySubtext: { fontSize: 14, color: '#9ca3af' },

  list: { padding: 16, gap: 10 },

  pageRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 12, padding: 12, gap: 12,
    borderWidth: 1, borderColor: '#e5e7eb',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  thumb: { width: 64, height: 80, borderRadius: 6, backgroundColor: '#f3f4f6' },
  pageInfo: { flex: 1, gap: 4 },
  pageNum: { fontSize: 15, fontWeight: '600', color: '#111827' },
  filterLabel: { fontSize: 13, color: '#6b7280' },
  pageActions: { flexDirection: 'row', gap: 6 },
  iconBtn: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: '#f3f4f6',
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnDisabled: { opacity: 0.3 },
  iconBtnDanger: { backgroundColor: '#fee2e2' },
  iconBtnText: { fontSize: 14, color: '#374151' },

  bottom: {
    backgroundColor: '#fff', padding: 16, gap: 10,
    borderTopWidth: 1, borderTopColor: '#e5e7eb',
  },
  exportRow: { flexDirection: 'row', gap: 10 },

  btn: {
    flex: 1, paddingVertical: 14, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: '#2563eb' },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnSecondary: { backgroundColor: '#e5e7eb', borderWidth: 1, borderColor: '#d1d5db' },
  btnSecondaryText: { color: '#374151', fontSize: 14, fontWeight: '600' },
  btnSuccess: { backgroundColor: '#22c55e' },
  btnSuccessText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnDisabled: { opacity: 0.4 },
});
