android {
    defaultConfig {
        applicationId = "com.example.indirect"
        versionCode = providers.gradleProperty("VERSION_CODE").get().toInt()
        versionName = "1.2.3"
    }
}
