plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "org.milksu.app"
  compileSdk = 35

  defaultConfig {
    applicationId = "org.milksu.app"
    minSdk = 26
    targetSdk = 35
    versionCode = 1
    versionName = "0.1.0"
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions {
    jvmTarget = "17"
  }
  buildFeatures {
    compose = true
  }
  composeOptions {
    kotlinCompilerExtensionVersion = "1.5.15"
  }
}

dependencies {
  val composeBom = platform("androidx.compose:compose-bom:2024.09.02")
  implementation(composeBom)
  implementation("androidx.activity:activity-compose:1.9.2")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.material:material-icons-extended")
  implementation("androidx.browser:browser:1.8.0")
  implementation("androidx.security:security-crypto:1.1.0")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
