plugins { id("com.android.application") }

android {
    namespace = "dev.plums.tlsprobe"
    compileSdk = 37
    defaultConfig {
        applicationId = "dev.plums.tlsprobe"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1"
    }
    signingConfigs.getByName("debug") {
        storeFile = file(System.getenv("PLUMS_ANDROID_DEBUG_KEYSTORE") ?: error("Set project debug keystore"))
        storePassword = "android"
        keyAlias = "androiddebugkey"
        keyPassword = "android"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildTypes.getByName("debug") { isMinifyEnabled = false }
}
dependencies { implementation(project(":verifier-support")) }
