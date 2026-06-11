# 🤖 Yarl's Web AI (Yarl's-AI)

[![Angular](https://img.shields.io/badge/Angular-v21.2.0-DD0031?style=flat-square&logo=angular)](https://angular.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4.2.1-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![Django](https://img.shields.io/badge/Django-v6.0-092E20?style=flat-square&logo=django)](https://www.djangoproject.com/)
[![DRF](https://img.shields.io/badge/DRF-v3.15-red?style=flat-square)](https://www.django-rest-framework.org/)
[![Ollama](https://img.shields.io/badge/Ollama-Offline%20LLM-black?style=flat-square)](https://ollama.com/)
[![Gemini](https://img.shields.io/badge/Gemini-Cloud%20AI-blue?style=flat-square&logo=google-gemini)](https://ai.google.dev/)

Yarl's Web AI is a premium, full-stack website builder and code-generation platform. It allows developers and designers to generate, edit, and preview fully functional responsive HTML/CSS/JS websites instantly from natural language instructions or wireframe mockups. It supports **hybrid LLM backends**, routing prompts to cloud models (Google Gemini) or local models (Ollama) seamlessly.

🔗 **Live Demo:** [https://isaiaruvi.free.nf/](https://yarl-s-ai.vercel.app/)

---

## 🌟 Key Features

*   **Hybrid Inference Engine**: Choose between high-performance cloud models (Gemini) or 100% private offline models (Ollama).
*   **Vision-to-Design**: Upload wireframe wireframes or UI sketches to generate structural code. Local vision uses `moondream:latest` to interpret layouts before generating source code.
*   **Split-Screen Sandbox**: View clean generated code side-by-side with an interactive visual preview panel.
*   **Context-Aware Iterations**: Modify existing applications in real-time. Short feedback loops (e.g. *"make buttons round"*, *"use dark theme"*) modify your existing web code instead of building a new application.
*   **Model Hot-Swapping**: Switch models on the fly using the built-in model manager.
*   **Docker Containerized**: Run frontend and backend microservices together out of the box using Docker Compose.

---

## 📸 Interface Preview

Here is a visual walkthrough of the Yarl's Web AI workspace.

| Welcome Landing Page | Code & Preview Workspace |
|:---:|:---:|
| ![1. Welcome Screen](screenshots/image1.png)<br>*Landing page welcoming user prompt input.* | ![4. Preview Screen](screenshots/image4.png)<br>*Fully generated interactive calculator preview.* |

### 🛠️ Interactive AI Workflow
| 1. Model Selector | 2. Writing Prompt | 3. Source Code Output |
|:---:|:---:|:---:|
| ![5. Model Selection](screenshots/image5.png)<br>*Switching between Cloud (Gemini) and Local (Ollama) models.* | ![2. Entering Prompts](screenshots/image2.png)<br>*Requesting a new component ("make calculator").* | ![3. Dynamic Code View](screenshots/image3.png)<br>*Instant code generation with custom template bindings.* |

---

## 📂 Project Directory Structure

```text
Yarl's-AI/
├── backend/                  # Django REST API Backend
│   ├── api/                  # Django App (Views, Endpoints, Router)
│   │   ├── views.py          # Gemini & Ollama Generation routing logic
│   │   ├── urls.py           # API routes (/generate/, /stop/, /models/)
│   │   └── tests.py          # API automated test scripts
│   ├── config/               # Django Main Config (settings.py, urls.py)
│   ├── requirements.txt      # Python dependencies (Django 6, Gemini, gunicorn)
│   ├── Dockerfile            # Container config for backend service
│   └── manage.py             # Django entrypoint script
├── front-end/                # Angular Frontend Client
│   ├── src/
│   │   ├── app/              # Angular Core Module
│   │   │   ├── components/   # UI Layouts (chat-panel, preview-panel)
│   │   │   ├── services/     # api.service.ts client connections
│   │   │   ├── app.ts        # Main app component script
│   │   │   └── app.html      # Main app component template layout
│   │   ├── styles.css        # Global custom styling rules
│   │   └── main.ts           # App startup config
│   ├── package.json          # Frontend packages & Angular build scripts
│   ├── Dockerfile            # Nginx deployment server container config
│   └── nginx.conf            # Custom proxy settings for Production build
├── screenshots/              # Git screenshots (image1.png to image5.png)
├── docker-compose.yml        # Orchestration file for full stack
├── .env                      # Global environment variable configuration
└── README.md                 # Project Documentation
```

---

## ⚙️ Prerequisites & Installation

### Option 1: Quick Start with Docker (Recommended)

To run the entire system (Frontend + Backend) inside Docker containers:

1. Clone this repository and navigate to the directory:
   ```bash
   git clone https://github.com/your-username/yarls-ai.git
   cd Yarl's-AI
   ```
2. Configure your environment variables in `.env` (see Environment Configuration section below).
3. Build and launch the containers:
   ```bash
   docker-compose up --build
   ```
4. Access the application:
   *   **Frontend Client**: `http://localhost:4200`
   *   **Backend Server API**: `http://localhost:8000/api/`

---

### Option 2: Running Locally for Development

#### 1. Backend Setup (Django REST Framework)
1. Navigate to the backend folder:
   ```bash
   cd backend
   ```
2. Create a virtual environment and activate it:
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```
3. Install the dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Run standard database migrations:
   ```bash
   python manage.py migrate
   ```
5. Spin up the development server:
   ```bash
   python manage.py runserver
   ```
   The backend server will run on `http://127.0.0.1:8000`.

#### 2. Frontend Setup (Angular)
1. Open a new terminal and navigate to the frontend folder:
   ```bash
   cd front-end
   ```
2. Install npm dependencies:
   ```bash
   npm install
   ```
3. Start the Angular dev server:
   ```bash
   npm run start
   ```
   The frontend UI will run on `http://localhost:4200`.

---

## 🧠 LLM Engine Setup (Ollama & Gemini)

Yarl's-AI matches prompts with the model of your choice:

### 🌐 Cloud Engine: Google Gemini
To run cloud models like `gemini-2.5-flash` or `gemini-1.5-pro`:
1. Obtain an API key from Google AI Studio.
2. Open the `.env` file in the project root and add your key:
   ```env
   GEMINI_API_KEY=your_actual_gemini_api_key_here
   ```

### 💻 Local Engine: Ollama
To run models locally offline:
1. Download and install [Ollama](https://ollama.com/).
2. Start the Ollama server:
   ```bash
   ollama serve
   ```
3. Pull the recommended code generation and vision models:
   ```bash
   # Code Generation model (DeepSeek-Coder)
   ollama pull deepseek-coder:6.7b
   
   # Vision model (Moondream for layout extraction)
   ollama pull moondream:latest
   
   # Optional alternative coding model
   ollama pull qwen2.5-coder:7b
   ```
4. Confirm your local models are ready:
   ```bash
   ollama list
   ```

---

## 🔒 Environment Configuration (`.env`)

Create a `.env` file in the root folder. Below is a production-ready template:

```env
# Google Gemini API key
GEMINI_API_KEY=AIzaSy...

# Django Web App configurations
DJANGO_SECRET_KEY=generate-a-long-secure-random-key-here
DJANGO_DEBUG=True
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost,localhost:4200

# CORS policies
CORS_ALLOW_ALL_ORIGINS=True

# Base URL to Ollama endpoint (For docker, use host.docker.internal to bridge host ports)
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

---

## 🧑‍💻 Technical Workflow Description
```mermaid
graph TD
    User([User Prompt / Sketch]) --> Client[Angular Frontend]
    Client -->|HTTP POST Request| API[Django REST Backend]
    API --> ModelRoute{Is Gemini Model Selected?}
    
    ModelRoute -->|Yes| GeminiAPI[Google Gemini SDK]
    ModelRoute -->|No| OllamaAPI[Local Ollama API Endpoint]
    
    OllamaAPI -->|If visual upload| Moondream[moondream:latest Vision Parse]
    Moondream -->|Image description| DeepseekCoder[deepseek-coder:6.7b Generate HTML]
    GeminiAPI -->|Direct Multi-modal prompt| CodeResponse[HTML Code & Chat Message]
    DeepseekCoder --> CodeResponse
    
    CodeResponse --> API
    API -->|JSON Response| Client
    Client -->|Render HTML Sandbox| Preview[Iframe Live Sandbox Preview]
```

---

## 🤝 Contribution Guidelines

Contributions are welcome! Please follow these steps to contribute:
1. Fork the Project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the Branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
