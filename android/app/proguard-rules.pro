# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# The app's own native code (com.anonymous.bulwarkmobile). What R8 must not
# drop or rename there is already covered elsewhere: React Native's rules keep
# every NativeModule, whose @ReactMethod methods JS calls by name, and AAPT
# keeps the application, activity and services listed in AndroidManifest.xml
# (FCM, UnifiedPush and the headless JS task). Keeping the package whole on
# top of that costs a few KB and leaves its class and method names readable
# in a crash report from an obfuscated release build.
-keep class com.anonymous.bulwarkmobile.** { *; }

# Room (used by WorkManager, which FCM and the headless tasks start at launch)
# creates its database through reflection: Class.forName("<name>_Impl"). With
# the optimizing default rules R8 renames the generated *_Impl class and the
# app dies in InitializationProvider at startup.
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep class androidx.work.impl.WorkDatabase_Impl { *; }
