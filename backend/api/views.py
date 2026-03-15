import requests
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
import base64
import re
import os
from datetime import datetime
from dotenv import load_dotenv
from pathlib import Path

try:
    import google.generativeai as genai
except ImportError:
    genai = None

# --- Robust Environment Loading ---
# We look for .env in the project root first, then the current directory
CURRENT_FILE = Path(__file__).resolve()
POSSIBLE_DOTENV_PATHS = [
    CURRENT_FILE.parent.parent.parent / '.env', # Project Root: d:\PythonProject\Yarl's-AI\.env
    CURRENT_FILE.parent.parent / '.env',        # Backend Root: d:\PythonProject\Yarl's-AI\backend\.env
    Path.cwd() / '.env',                       # Current Working Directory
]

for env_path in POSSIBLE_DOTENV_PATHS:
    if env_path.exists():
        load_dotenv(dotenv_path=str(env_path))
        print(f"✅ Loaded environment from: {env_path}")
        break


def refresh_runtime_env():
    """Reload env vars so .env edits are reflected without a process restart."""
    for env_path in POSSIBLE_DOTENV_PATHS:
        if env_path.exists():
            load_dotenv(dotenv_path=str(env_path), override=True)
            break


def get_gemini_api_key():
    refresh_runtime_env()
    return os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")


GEMINI_API_KEY = get_gemini_api_key()
OLLAMA_BASE_URL = os.getenv('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').rstrip('/')
OLLAMA_GENERATE_URL = f"{OLLAMA_BASE_URL}/api/generate"
OLLAMA_CHAT_URL = f"{OLLAMA_BASE_URL}/api/chat"
OLLAMA_TAGS_URL = f"{OLLAMA_BASE_URL}/api/tags"

if GEMINI_API_KEY and genai is not None:
    genai.configure(api_key=GEMINI_API_KEY)
    print("✅ Gemini AI services are active.")
elif GEMINI_API_KEY and genai is None:
    print("⚠️ Gemini API key found, but google-generativeai is not installed. Gemini routes are disabled.")
else:
    print("⚠️ Gemini API key not found. Gemini models will be unavailable.")

SYSTEM_PROMPT = """You are Yarl's Web AI, a professional web developer.

Response modes:
- If the user asks conversational or meta questions (for example: your name, greetings, date/time, age, weather, or personal info), return a short plain-text reply only and do not return HTML.
- For website/app building requests, you MUST follow the HTML rules below.

HTML rules for build requests:
- Return ONLY one complete HTML document.
- Put all CSS inside a single <style> tag in the <head>.
- Use JavaScript only when absolutely necessary, and if needed put it inside a <script> tag before </body>.
- Never use external CSS or JavaScript files.
- Never explain the code.
- Always return the full updated HTML, never a partial snippet.

When the request includes existing HTML or refers to a previous result:
- Treat the user message as a modification request for that exact current website/app.
- Preserve the current app type, purpose, and core functionality unless the user clearly asks for a completely new website or a rebuild from scratch.
- Short follow-up instructions such as "black", "dark", "blue", "make it modern", or "change button color" must update the current design, not generate a different website.
- Example: if the current page is a calculator and the user says "black", return the same calculator with a black/dark theme.

Identity policy:
- If asked who you are or your name, answer: "I am Yarl's Web AI."
- If asked unrelated personal questions, answer: "I am only here to help you build websites."""

NEW_PROJECT_PATTERN = re.compile(
    r'\b('
    r'start over|from scratch|brand new|completely new|create a new|make a new|'
    r'new website|another website|different website|new app|another app|different app|'
    r'new page|another page|different page|replace everything|rebuild it'
    r')\b',
    re.IGNORECASE,
)

WEB_REQUEST_HINT_PATTERN = re.compile(
    r'\b('
    r'html|css|javascript|js|website|web\s*app|webapp|landing\s*page|ui|ux|'
    r'component|navbar|footer|hero|form|button|card|section|layout|preview|'
    r'style|theme|responsive|animation|angular|react|vue|django|flask|'
    r'portfolio|dashboard|calculator|ecommerce|to\s*do|todo|chatbot'
    r')\b',
    re.IGNORECASE,
)

NAME_QUERY_PATTERN = re.compile(
    r'\b('
    r'who\s+are\s+you|your\s+name|what\s+is\s+your\s+name|what\s+should\s+i\s+call\s+you|'
    r'what\s+do\s+i\s+call\s+you|call\s+you|introduce\s+yourself'
    r')\b',
    re.IGNORECASE,
)

GREETING_PATTERN = re.compile(
    r'^(hi|hello|hey|yo|hola|hiya|good\s+morning|good\s+afternoon|good\s+evening)\b[!.?\s]*$',
    re.IGNORECASE,
)

TIME_QUERY_PATTERN = re.compile(
    r'\b('
    r'what\s+time\s+is\s+it|current\s+time|time\s+now|tell\s+me\s+the\s+time|'
    r'what\s+date\s+is\s+it|today\'?s\s+date|current\s+date|what\s+day\s+is\s+it|today\s+day'
    r')\b',
    re.IGNORECASE,
)

OFFTOPIC_PERSONAL_PATTERN = re.compile(
    r'\b('
    r'how\s+old\s+are\s+you|your\s+age|where\s+do\s+you\s+live|where\s+are\s+you\s+from|'
    r'weather|temperature|are\s+you\s+human|do\s+you\s+have\s+feelings|who\s+made\s+you|'
    r'who\s+created\s+you'
    r')\b',
    re.IGNORECASE,
)


def should_treat_as_new_request(prompt_text):
    return bool(NEW_PROJECT_PATTERN.search((prompt_text or '').strip()))


def build_chat_only_reply(prompt_text):
    text = (prompt_text or '').strip()
    if not text:
        return None

    # If the prompt clearly references web output, do not short-circuit.
    if WEB_REQUEST_HINT_PATTERN.search(text):
        return None

    if NAME_QUERY_PATTERN.search(text):
        return "I am Yarl's Web AI."

    if TIME_QUERY_PATTERN.search(text):
        now = datetime.now()
        return f"Current date and time: {now.strftime('%A, %B %d, %Y, %I:%M %p')}"

    if GREETING_PATTERN.match(text):
        return "Hi! I am Yarl's Web AI. Tell me what website you want to build."

    if OFFTOPIC_PERSONAL_PATTERN.search(text):
        return "I am only here to help you build websites."

    return None


def build_generation_prompt(prompt, previous_html='', image_description=''):
    user_instruction = (prompt or '').strip()
    existing_html = (previous_html or '').strip()
    image_description = (image_description or '').strip()

    if existing_html and not should_treat_as_new_request(user_instruction):
        effective_instruction = user_instruction or 'Update the current page based on the provided reference.'
        sections = [
            'Modify the existing website/app below.',
            'Treat the user instruction as an edit request for the current project, not a brand new website.',
            'Preserve the current product type, layout intent, and working features unless the user clearly asks for a full redesign or a completely new app.',
            'Short follow-up requests like "black", "dark", "blue", "bigger", or "round buttons" must update the current page instead of replacing it with a different website.',
            f'Instruction: {effective_instruction}',
        ]

        if image_description:
            sections.extend([
                '',
                'Reference UI Description:',
                image_description,
            ])

        sections.extend([
            '',
            'Existing HTML:',
            existing_html,
        ])
        return '\n'.join(sections)

    effective_instruction = user_instruction or 'Create a professional website.'
    sections = [
        'Create a complete website/app that satisfies the user instruction.',
        f'Instruction: {effective_instruction}',
    ]

    if image_description:
        sections.extend([
            '',
            'Reference UI Description:',
            image_description,
        ])

    return '\n'.join(sections)

def extract_html(text):
    md_match = re.search(r'```(?:html|xml)?\s*(.*?)\s*```', text, re.IGNORECASE | re.DOTALL)
    if md_match:
        return md_match.group(1).strip(), True
    tag_match = re.search(r'(<(?:!DOCTYPE|html).*?>.*?</(?:html|body)>)', text, re.IGNORECASE | re.DOTALL)
    if tag_match:
        return tag_match.group(1).strip(), True
    return text.strip(), False

class GenerateView(APIView):
    def post(self, request):
        gemini_api_key = get_gemini_api_key()
        raw_prompt = request.data.get('prompt', '')
        image = request.data.get('image', None)
        previous_html = request.data.get('previousHtml', '')
        selected_model = request.data.get('model', 'deepseek-coder:6.7b')

        print(f"📡 Request received. Model: {selected_model}")

        if not raw_prompt and not image:
            return Response({'error': 'Please provide prompt or image'}, status=status.HTTP_400_BAD_REQUEST)

        # Route simple non-web chat to message-only output so preview is unaffected.
        if not image:
            chat_only_reply = build_chat_only_reply(raw_prompt)
            if chat_only_reply:
                return Response({
                    'html': '',
                    'message': chat_only_reply,
                    'is_web_output': False,
                    'model_used': 'router-chat-only'
                }, status=status.HTTP_200_OK)

        prompt_lower = raw_prompt.lower().strip()
        stop_words = ['stop', 'bye', 'exit', 'quit', 'terminate', 'close']
        
        if any(word == prompt_lower for word in stop_words) or (len(prompt_lower) < 10 and any(word in prompt_lower for word in ['bye', 'stop'])):
            try:
                for m in [selected_model, 'moondream:latest']:
                    if 'gemini' not in m.lower():
                        requests.post(OLLAMA_GENERATE_URL,
                                     json={'model': m, 'keep_alive': 0}, timeout=2)
                return Response({'html': '', 'message': "AI Stopped and models unloaded. Goodbye!", 'is_web_output': False}, status=status.HTTP_200_OK)
            except:
                return Response({'message': "Stop signal sent.", 'html': '', 'is_web_output': False}, status=status.HTTP_200_OK)

        contextual_prompt = build_generation_prompt(raw_prompt, previous_html=previous_html)

        # --- GEMINI ROUTING ---
        if 'gemini' in selected_model.lower():
            if genai is None:
                return Response({'error': 'Gemini support is unavailable because google-generativeai is not installed in the backend environment.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            if not gemini_api_key:
                return Response({'error': 'Gemini API Key missing in backend .env'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            genai.configure(api_key=gemini_api_key)
            
            try:
                # Use standard model names with -latest for better stability
                # The library handles 'models/' prefix automatically.
                model_name = selected_model.split(' ')[0]
                if model_name in ['gemini-1.5-flash', 'gemini-1.5-pro']:
                    model_name = f"{model_name}-latest"
                
                print(f"💎 Routing to Gemini: {model_name}")
                
                model = genai.GenerativeModel(
                    model_name=model_name,
                    system_instruction=SYSTEM_PROMPT
                )
                
                content = []
                content.append(contextual_prompt or "Create a professional website based on this image.")
                if image:
                    img_data = image.split(',')[1] if ',' in image else image
                    content.append({'mime_type': 'image/png', 'data': img_data})
                
                response = model.generate_content(content)
                
                if not response or not response.text:
                   return Response({'error': 'Gemini returned an empty response. This might be a safety filter or API issue.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

                generated_text = response.text
                clean_html, is_code = extract_html(generated_text)
                
                return Response({
                    'html': clean_html if is_code else '',
                    'message': f"Generated via Gemini ({model_name})" if is_code else generated_text,
                    'is_web_output': is_code,
                    'model_used': selected_model
                }, status=status.HTTP_200_OK)
            except Exception as e:
                err_str = str(e)
                print(f"❌ Gemini API Error: {err_str}")
                if "404" in err_str:
                    return Response({'error': f"Gemini Model '{model_name}' not found. Try selecting gemini-1.5-flash-latest or verify your API key access."}, status=status.HTTP_404_NOT_FOUND)
                return Response({'error': f"Gemini Error: {err_str}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # --- OLLAMA ROUTING (Local) ---
        try:
            image_description = ""
            if image:
                # Local Vision Step
                img_data = image.split(',')[1] if ',' in image else image
                vision_payload = {
                    'model': 'moondream:latest',
                    'messages': [{'role': 'user', 'content': "Describe this layout in detail for a developer.", 'images': [img_data]}],
                    'stream': False
                }
                v_res = requests.post(OLLAMA_CHAT_URL, json=vision_payload, timeout=600)
                image_description = v_res.json().get('message', {}).get('content', '')
            
            final_prompt = build_generation_prompt(
                raw_prompt,
                previous_html=previous_html,
                image_description=image_description if image else '',
            )
            
            payload = {
                'model': selected_model,
                'prompt': final_prompt,
                'system': SYSTEM_PROMPT,
                'stream': False
            }
            res = requests.post(OLLAMA_GENERATE_URL, json=payload, timeout=600)
            res.raise_for_status()
            generated_text = res.json().get('response', '')
            clean_html, is_code = extract_html(generated_text)
            
            return Response({
                'html': clean_html if is_code else '',
                'message': f"Generated via {selected_model} (Local)" if is_code else generated_text,
                'is_web_output': is_code,
                'model_used': selected_model
            }, status=status.HTTP_200_OK)
                
        except Exception as e:
            return Response({'error': f"Local API Error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class StopGenerationView(APIView):
    def post(self, request):
        try:
            for m in ['deepseek-coder:6.7b', 'moondream:latest', 'qwen3-vl:8b']:
                requests.post(OLLAMA_GENERATE_URL, json={'model': m, 'keep_alive': 0}, timeout=1)
            return Response({'message': 'Stopped.'}, status=status.HTTP_200_OK)
        except:
            return Response({'message': 'Done.'}, status=status.HTTP_200_OK)

class ListModelsView(APIView):
    def get(self, request):
        """Returns a list of both Cloud (Gemini) and Local models."""
        gemini_api_key = get_gemini_api_key()

        cloud_models = []
        local_models = []
        models = []
        
        # --- 1. Dynamic Cloud Models (Fetch from Gemini API) ---
        if gemini_api_key and genai is not None:
            try:
                genai.configure(api_key=gemini_api_key)
                requested_gems = ['gemini-3-flash', 'gemini-2.5-flash', 'gemini-3.1-pro', 'gemini-3.1-flash-image', 'gemini-3-flash-preview']
                for m in genai.list_models():
                    if 'generateContent' in m.supported_generation_methods:
                        name = m.name.replace('models/', '')
                        # Only include if it matches the requested list
                        if any(req in name.lower() for req in requested_gems):
                            cloud_models.append(name)
                
                # If the search didn't find them but the user explicitly wants them, 
                # ensure we show at least their requested versions if the API allows.
                if not any('gemini' in m for m in cloud_models):
                    cloud_models.extend([g for g in requested_gems if 'image' not in g])
                
                # If the search didn't find them, add them manually as a safety fallback
                if not any('gemini' in m for m in cloud_models):
                    cloud_models.extend(['gemini-1.5-flash', 'gemini-1.5-pro'])
            except Exception as e:
                print(f"⚠️ Could not fetch Gemini models: {e}")
                cloud_models.extend(['gemini-1.5-flash', 'gemini-1.5-pro'])
        elif gemini_api_key and genai is None:
            print("⚠️ Gemini API key exists but google-generativeai is not installed.")
            cloud_models.extend(['gemini-1.5-flash', 'gemini-1.5-pro'])
        
        # --- 2. Local Models (Fetch from Ollama) ---
        try:
            response = requests.get(OLLAMA_TAGS_URL, timeout=1)
            if response.status_code == 200:
                data = response.json()
                ollama_models = [m['name'] for m in data.get('models', []) if 'moondream' not in m['name'].lower()]
                local_models.extend(ollama_models)
        except:
            # Fallback if Ollama is not local but we want to show the option
            local_models.extend(['deepseek-coder:6.7b', 'qwen3-vl:8b'])
            
        cloud_models = list(dict.fromkeys(cloud_models))
        local_models = list(dict.fromkeys(local_models))
        models = list(dict.fromkeys(cloud_models + local_models))

        return Response(
            {
                'models': models,
                'cloud_models': cloud_models,
                'local_models': local_models,
            },
            status=status.HTTP_200_OK
        )
