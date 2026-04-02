import React, { useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  StatusBar, Platform, Alert,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Camera'>;

export default function CameraScreen() {
  const navigation = useNavigation<Nav>();
  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [permission, requestPermission] = useCameraPermissions();

  const goToEdit = useCallback((uri: string) => {
    navigation.replace('Edit', { uri, pageId: undefined });
  }, [navigation]);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.92 });
      if (photo?.uri) goToEdit(photo.uri);
    } catch (e) {
      Alert.alert('拍照失敗', '請重試');
    }
  }, [goToEdit]);

  const handlePickImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('需要相簿權限', '請在設定中允許存取相簿');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.92,
      allowsMultipleSelection: false,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      goToEdit(result.assets[0].uri);
    }
  }, [goToEdit]);

  if (!permission) {
    return <View style={styles.center}><Text>載入中...</Text></View>;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.permText}>需要相機權限才能拍照</Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>授權相機</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.galleryFallback} onPress={handlePickImage}>
            <Text style={styles.galleryFallbackText}>📂 從相簿選擇</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <CameraView ref={cameraRef} style={styles.camera} facing={facing}>
        {/* Top bar */}
        <SafeAreaView style={styles.topBar}>
          <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.cameraTitle}>拍照掃描</Text>
          <TouchableOpacity
            style={styles.flipBtn}
            onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))}
          >
            <Text style={styles.flipBtnText}>🔄</Text>
          </TouchableOpacity>
        </SafeAreaView>

        {/* Bottom controls */}
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.galleryBtn} onPress={handlePickImage}>
            <Text style={styles.galleryBtnText}>📂</Text>
            <Text style={styles.galleryBtnLabel}>相簿</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.captureBtn} onPress={handleCapture} activeOpacity={0.8}>
            <View style={styles.captureBtnInner} />
          </TouchableOpacity>

          <View style={{ width: 64 }} />
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 20 },

  permText: { fontSize: 16, color: '#374151', textAlign: 'center' },
  permBtn: {
    backgroundColor: '#2563eb', paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 10,
  },
  permBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  galleryFallback: { paddingVertical: 10 },
  galleryFallbackText: { fontSize: 15, color: '#2563eb' },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  closeBtn: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20,
  },
  closeBtnText: { color: '#fff', fontSize: 18 },
  cameraTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  flipBtn: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20,
  },
  flipBtnText: { fontSize: 20 },

  bottomBar: {
    position: 'absolute', bottom: 48, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingHorizontal: 32,
  },
  galleryBtn: { width: 64, alignItems: 'center', gap: 4 },
  galleryBtnText: { fontSize: 28 },
  galleryBtnLabel: { color: '#fff', fontSize: 12 },

  captureBtn: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 4, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  captureBtnInner: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff',
  },
});
