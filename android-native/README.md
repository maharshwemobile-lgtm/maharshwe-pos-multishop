# Mahar POS Native Android

Native Kotlin + Jetpack Compose client for Mahar POS multi-shop.

## Requirements

- Android Studio with JDK 17
- Android SDK 35+
- Internet access to `https://app.maharshwe.shop`

## Debug build

Run `gradle :app:assembleDebug` or open the project in Android Studio.

## Release signing

Create a local, untracked `key.properties` file:

```properties
storeFile=C:/secure/path/mahar-pos-upload.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=YOUR_KEY_ALIAS
keyPassword=YOUR_KEY_PASSWORD
```

Never commit the keystore or signing passwords.
