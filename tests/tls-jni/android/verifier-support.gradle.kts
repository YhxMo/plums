plugins { id("com.android.library") }
android {
    namespace = "org.rustls.platformverifier"
    compileSdk = 37
    defaultConfig {
        minSdk = 26
        // Upstream's official mock-store switch, NEVER a production dependency.
        buildConfigField("boolean", "TEST", "true")
    }
    buildFeatures { buildConfig = true }
}
dependencies { implementation("org.jetbrains.kotlin:kotlin-stdlib:2.2.10") }
