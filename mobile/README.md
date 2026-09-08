# Sahayak Mobile App 📱

React Native + Expo app for the Sahayak roadside assistance platform.

## Stack
| Layer | Library |
|---|---|
| Framework | React Native + Expo (blank-typescript) |
| Navigation | React Navigation v7 (Stack + Bottom Tabs) |
| State | Zustand |
| API | Axios + React Query |
| Location | expo-location |
| Camera | expo-image-picker / expo-camera |
| Icons | @expo/vector-icons |

## Folder Structure
```
mobile/
├── App.tsx                     # Root entry — QueryClient + Navigator
├── src/
│   ├── navigation/
│   │   └── RootNavigator.tsx   # Auth gate + tab navigator
│   ├── features/
│   │   ├── auth/screens/       # LoginScreen
│   │   ├── jobs/screens/       # HomeScreen (request help)
│   │   ├── tracking/screens/   # TrackingScreen (live map)
│   │   └── profile/screens/    # ProfileScreen
│   ├── components/
│   │   ├── ui/                 # Shared buttons, cards, inputs
│   │   ├── maps/               # Map component wrappers
│   │   └── forms/              # Form field components
│   ├── services/api/
│   │   ├── client.ts           # Axios instance + interceptors
│   │   └── jobs.ts             # Jobs API calls
│   ├── store/
│   │   └── authStore.ts        # Zustand auth store
│   ├── types/index.ts          # Shared TypeScript types
│   └── constants/index.ts      # API URL, enums, constants
```

## Getting Started

```bash
# Install dependencies
cd mobile && npm install

# Start dev server
npm start

# Scan QR with Expo Go app on your phone
```

## Generate APK (for evaluators)

```bash
# Install EAS CLI once
npm install -g eas-cli
eas login

# Build preview APK (no App Store)
eas build -p android --profile preview
```
