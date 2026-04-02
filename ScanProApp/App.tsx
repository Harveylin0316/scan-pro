import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import HomeScreen   from './src/screens/HomeScreen';
import CameraScreen from './src/screens/CameraScreen';
import EditScreen   from './src/screens/EditScreen';

export type RootStackParamList = {
  Home:   undefined;
  Camera: undefined;
  Edit:   { uri: string; pageId: string | undefined };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Home"   component={HomeScreen} />
          <Stack.Screen name="Camera" component={CameraScreen} />
          <Stack.Screen name="Edit"   component={EditScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
