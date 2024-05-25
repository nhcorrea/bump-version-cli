# Bump Version CLI

## Description

Bump Version CLI is a command-line tool for managing iOS and Android project versions. It allows you to update and view Android and iOS app versions directly from the command line.

## Installation

To install Bump Version CLI, you need to have Node.js installed. Then, run the following command:

```bash
npm install -g @nhcorrea/bump-version-cli
```

## Usage

### Displaying Version

To display the current version of Bump Version CLI, you can use the following command:

```bash
bump-version --version
```

### Managing Android Versions

To manage Android app versions, you can use the following commands:

- `bump-version android-version`: Displays the current version of the Android app and its information.

- `bump-version android`: Updates the version of the Android app interactively.

### Managing iOS Versions

To manage iOS app versions, you can use the following commands:

- `bump-version ios-version <project_name>`: Displays the current version of the iOS app and its information, where <project_name> is the name of the iOS project.
- `bump-version ios <project_name>`: Updates the version of the iOS app interactively, where <project_name> is the name of the iOS project.

## Contribution

Contributions are welcome! If you find a bug or have an improvement suggestion, please open an issue or submit a pull request.
