# AI Model Dashboard

A local AI model management dashboard for discovering, configuring, launching, and monitoring local inference servers.

The goal of **AI Model Dashboard** is to replace a collection of shell scripts and manual commands with a convenient web interface for managing local AI models and inference backends.

The project is written in **TypeScript** and uses **Vite** for the frontend build tooling.

## Features

The dashboard is designed to provide:

- 📦 Local model discovery and management
- 📁 Configurable model directories
- ⚙️ Model and inference parameter configuration
- 🧠 Model capability definitions:
  - Text
  - Vision
  - Audio
  - Tool calling
  - Thinking / reasoning
  - Image generation
- 🚀 Start, stop, and restart inference servers
- 📊 Server status and health monitoring
- 📝 stdout / stderr and server logs
- 💻 Resource and process information
- 🔌 API status and connectivity monitoring
- 💾 Saved model configurations and presets
- 🔧 Backend-specific configuration
- 🧩 Extensible inference backend architecture

## Supported Backends

The initial backend target is:

- **llama.cpp / llama-server**

The architecture is designed to allow additional inference backends to be added in the future without coupling the entire application to a single inference engine.

## Architecture

The project is structured around a separation between:

```text
Frontend
   │
   ▼
Backend / Application API
   │
   ▼
Inference Backend Abstraction
   │
   ├── llama.cpp
   ├── future backend
   └── future backend
```

This allows the dashboard to manage different inference engines through a common interface while keeping backend-specific functionality isolated.

## Tech Stack

- **TypeScript**
- **Vite**
- Modern web frontend
- Local backend / process management
- llama.cpp / llama-server

## Development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build the project:

```bash
npm run build
```

Run tests:

```bash
npm test
```

> Available scripts may change as development progresses.

## Project Status

🚧 **Early development**

The project is currently being actively developed. The initial focus is on establishing the architecture, model management, backend abstraction, and llama.cpp integration.

## Goals

The long-term goal is to provide a single interface for managing a local AI environment:

- discover models
- configure models
- select inference parameters
- launch inference servers
- monitor running models
- inspect logs and errors
- manage multiple inference backends
- create reusable model presets

The dashboard should make running local AI models as convenient as managing applications through a normal desktop/web interface, without requiring users to maintain large collections of shell scripts.

## License

License to be determined.