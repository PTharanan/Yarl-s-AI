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


def is_running_in_docker():
    return Path('/.dockerenv').exists()


def get_ollama_base_urls():
    refresh_runtime_env()
    configured = (os.getenv('OLLAMA_BASE_URL') or '').strip().rstrip('/')
    running_in_docker = is_running_in_docker()

    if running_in_docker:
        default_candidates = [
            'http://host.docker.internal:11434',
            'http://172.17.0.1:11434',
            'http://127.0.0.1:11434',
            'http://localhost:11434',
        ]
    else:
        default_candidates = [
            'http://127.0.0.1:11434',
            'http://localhost:11434',
            'http://host.docker.internal:11434',
        ]

    candidates = []
    configured_first = True
    if configured:
        configured_lower = configured.lower()
        if (not running_in_docker and 'host.docker.internal' in configured_lower) or (
            running_in_docker and ('127.0.0.1' in configured_lower or 'localhost' in configured_lower)
        ):
            configured_first = False

        if configured_first:
            candidates.append(configured)

    candidates.extend(default_candidates)

    if configured and not configured_first:
        candidates.append(configured)

    unique_candidates = []
    for candidate in candidates:
        normalized = candidate.strip().rstrip('/')
        if normalized and normalized not in unique_candidates:
            unique_candidates.append(normalized)

    return unique_candidates


def ollama_request(method, endpoint, json_payload=None, timeout=(5, 120), require_success=False):
    attempted_urls = []
    last_error = None

    for base_url in get_ollama_base_urls():
        url = f"{base_url}{endpoint}"
        attempted_urls.append(url)
        try:
            request_kwargs = {
                'method': method,
                'url': url,
                'timeout': timeout,
            }
            if json_payload is not None:
                request_kwargs['json'] = json_payload

            response = requests.request(**request_kwargs)
            if require_success:
                response.raise_for_status()
            return response
        except requests.RequestException as exc:
            last_error = exc

    raise RuntimeError(
        f"Could not connect to Ollama. Tried: {', '.join(attempted_urls)}. Last error: {last_error}"
    )

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


# --- Provider default base URLs ---
PROVIDER_DEFAULTS = {
    'openai':    'https://api.openai.com/v1',
    'deepseek':  'https://api.deepseek.com/v1',
    'zai':       'https://api.z.ai/api/paas/v4',
    'anthropic': 'https://api.anthropic.com',
    'ollama':    'http://127.0.0.1:11434/v1',
    'custom':    '',
    # 'gemini' has no base_url — uses google-generativeai SDK.
}

OPENAI_COMPATIBLE_PROVIDERS = {'openai', 'deepseek', 'zai', 'ollama', 'custom'}


def call_openai_compatible(base_url, api_key, model, system_prompt, user_content, image_b64=None, timeout=(5, 300)):
    """Call any OpenAI-compatible /chat/completions endpoint and return the assistant text."""
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }
    messages = []
    messages.append({'role': 'system', 'content': system_prompt})

    user_parts = [{'type': 'text', 'text': user_content}]
    if image_b64:
        user_parts.append({
            'type': 'image_url',
            'image_url': {'url': f'data:image/png;base64,{image_b64}'},
        })
    messages.append({'role': 'user', 'content': user_parts})

    payload = {
        'model': model,
        'messages': messages,
        'stream': False,
    }

    res = requests.post(url, json=payload, headers=headers, timeout=timeout)
    res.raise_for_status()
    data = res.json()

    # Standard OpenAI response shape.
    return data['choices'][0]['message']['content']


def call_anthropic(base_url, api_key, model, system_prompt, user_content, image_b64=None, timeout=(5, 300)):
    """Call the Anthropic /v1/messages endpoint and return the assistant text."""
    url = f"{base_url.rstrip('/')}/v1/messages"
    headers = {
        'x-api-key': api_key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
    }

    user_parts = [{'type': 'text', 'text': user_content}]
    if image_b64:
        user_parts.append({
            'type': 'image',
            'source': {'type': 'base64', 'media_type': 'image/png', 'data': image_b64},
        })

    payload = {
        'model': model,
        'max_tokens': 8192,
        'system': system_prompt,
        'messages': [{'role': 'user', 'content': user_parts}],
    }

    res = requests.post(url, json=payload, headers=headers, timeout=timeout)
    res.raise_for_status()
    data = res.json()

    return data['content'][0]['text']

class GenerateView(APIView):
    def post(self, request):
        raw_prompt = request.data.get('prompt', '')
        image = request.data.get('image', None)
        previous_html = request.data.get('previousHtml', '')
        selected_model = request.data.get('model', 'deepseek-coder:6.7b')
        provider_cfg = request.data.get('provider_config')  # Optional client provider config

        # Determine routing: provider_config (client) > server-side defaults.
        using_provider_config = isinstance(provider_cfg, dict) and provider_cfg.get('api_key')

        print(f"📡 Request received. Model: {selected_model} | Provider config: {'yes' if using_provider_config else 'no'}")

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
                        ollama_request(
                            'POST',
                            '/api/generate',
                            json_payload={'model': m, 'keep_alive': 0},
                            timeout=(2, 2),
                        )
                return Response({'html': '', 'message': "AI Stopped and models unloaded. Goodbye!", 'is_web_output': False}, status=status.HTTP_200_OK)
            except:
                return Response({'message': "Stop signal sent.", 'html': '', 'is_web_output': False}, status=status.HTTP_200_OK)

        contextual_prompt = build_generation_prompt(raw_prompt, previous_html=previous_html)
        image_b64 = (image.split(',')[1] if ',' in image else image) if image else None

        # ===================================================================
        # 1. CLIENT PROVIDER CONFIG (OpenAI-compatible / Anthropic / Gemini)
        # ===================================================================
        if using_provider_config:
            provider = (provider_cfg.get('provider') or '').strip().lower()
            api_key = (provider_cfg.get('api_key') or '').strip()
            model_name = (provider_cfg.get('model') or selected_model).strip()
            base_url = (provider_cfg.get('base_url') or '').strip() or PROVIDER_DEFAULTS.get(provider, '')

            # --- Anthropic (Claude) ---
            if provider == 'anthropic':
                if not base_url:
                    base_url = PROVIDER_DEFAULTS['anthropic']
                try:
                    print(f"🟣 Routing to Anthropic: {model_name}")
                    generated_text = call_anthropic(
                        base_url, api_key, model_name,
                        SYSTEM_PROMPT, contextual_prompt, image_b64=image_b64,
                    )
                    clean_html, is_code = extract_html(generated_text)
                    return Response({
                        'html': clean_html if is_code else '',
                        'message': f"Generated via Anthropic ({model_name})" if is_code else generated_text,
                        'is_web_output': is_code,
                        'model_used': model_name,
                    }, status=status.HTTP_200_OK)
                except Exception as e:
                    err_str = str(e)
                    print(f"❌ Anthropic API Error: {err_str}")
                    return Response({'error': f"Anthropic Error: {err_str}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            # --- Gemini (via google-generativeai SDK) ---
            if provider == 'gemini':
                if genai is None:
                    return Response({'error': 'Gemini support is unavailable because google-generativeai is not installed.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
                if not api_key:
                    return Response({'error': 'Gemini API Key missing.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
                genai.configure(api_key=api_key)
                try:
                    if model_name in ['gemini-1.5-flash', 'gemini-1.5-pro']:
                        model_name = f"{model_name}-latest"
                    print(f"💎 Routing to Gemini (client key): {model_name}")
                    model = genai.GenerativeModel(model_name=model_name, system_instruction=SYSTEM_PROMPT)
                    content = [contextual_prompt or "Create a professional website based on this image."]
                    if image_b64:
                        content.append({'mime_type': 'image/png', 'data': image_b64})
                    response = model.generate_content(content)
                    if not response or not response.text:
                        return Response({'error': 'Gemini returned an empty response.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
                    generated_text = response.text
                    clean_html, is_code = extract_html(generated_text)
                    return Response({
                        'html': clean_html if is_code else '',
                        'message': f"Generated via Gemini ({model_name})" if is_code else generated_text,
                        'is_web_output': is_code,
                        'model_used': model_name,
                    }, status=status.HTTP_200_OK)
                except Exception as e:
                    err_str = str(e)
                    print(f"❌ Gemini API Error: {err_str}")
                    return Response({'error': f"Gemini Error: {err_str}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            # --- OpenAI-compatible (openai, deepseek, zai, ollama, custom) ---
            if not base_url:
                base_url = PROVIDER_DEFAULTS.get(provider, '')
            if not base_url:
                return Response({'error': f"No base URL known for provider '{provider}'. Set one in the settings."}, status=status.HTTP_400_BAD_REQUEST)
            try:
                provider_label = provider.upper() if provider != 'zai' else 'z.ai'
                print(f"⚡ Routing to {provider_label} (OpenAI-compatible): {model_name} @ {base_url}")
                generated_text = call_openai_compatible(
                    base_url, api_key, model_name,
                    SYSTEM_PROMPT, contextual_prompt, image_b64=image_b64,
                )
                clean_html, is_code = extract_html(generated_text)
                return Response({
                    'html': clean_html if is_code else '',
                    'message': f"Generated via {provider_label} ({model_name})" if is_code else generated_text,
                    'is_web_output': is_code,
                    'model_used': model_name,
                }, status=status.HTTP_200_OK)
            except Exception as e:
                err_str = str(e)
                print(f"❌ {provider.upper()} API Error: {err_str}")
                return Response({'error': f"Provider Error: {err_str}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # ===================================================================
        # 2. SERVER-SIDE DEFAULTS (no provider_config from client)
        # ===================================================================
        gemini_api_key = get_gemini_api_key()

        # --- GEMINI ROUTING (server-side key) ---
        if 'gemini' in selected_model.lower():
            if genai is None:
                return Response({'error': 'Gemini support is unavailable because google-generativeai is not installed in the backend environment.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            if not gemini_api_key:
                return Response({'error': 'Gemini API Key missing in backend .env'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            genai.configure(api_key=gemini_api_key)

            try:
                model_name = selected_model.split(' ')[0]
                if model_name in ['gemini-1.5-flash', 'gemini-1.5-pro']:
                    model_name = f"{model_name}-latest"

                print(f"💎 Routing to Gemini (server key): {model_name}")

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
                v_res = ollama_request(
                    'POST',
                    '/api/chat',
                    json_payload=vision_payload,
                    timeout=(5, 600),
                    require_success=True,
                )
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
            res = ollama_request(
                'POST',
                '/api/generate',
                json_payload=payload,
                timeout=(5, 600),
                require_success=True,
            )
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
                ollama_request(
                    'POST',
                    '/api/generate',
                    json_payload={'model': m, 'keep_alive': 0},
                    timeout=(1, 2),
                )
            return Response({'message': 'Stopped.'}, status=status.HTTP_200_OK)
        except:
            return Response({'message': 'Done.'}, status=status.HTTP_200_OK)

class ListModelsView(APIView):
    def get(self, request):
        """Returns server-side Gemini + Ollama models (no client key in play)."""
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
            response = ollama_request('GET', '/api/tags', timeout=(1, 2))
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

    def post(self, request):
        """Returns models for a client-supplied provider config (bring your own key)."""
        provider_cfg = request.data.get('provider_config')
        if not isinstance(provider_cfg, dict) or not provider_cfg.get('api_key'):
            return Response(
                {'error': 'provider_config with api_key is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        provider = (provider_cfg.get('provider') or '').strip().lower()
        api_key = (provider_cfg.get('api_key') or '').strip()
        base_url = (provider_cfg.get('base_url') or '').strip() or PROVIDER_DEFAULTS.get(provider, '')

        cloud_models = []

        # --- Gemini (via google-generativeai SDK) ---
        if provider == 'gemini':
            if genai is None:
                return Response({'error': 'Gemini support unavailable (google-generativeai not installed).'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            try:
                genai.configure(api_key=api_key)
                for m in genai.list_models():
                    if 'generateContent' in m.supported_generation_methods:
                        cloud_models.append(m.name.replace('models/', ''))
            except Exception as e:
                print(f"⚠️ Could not fetch Gemini models (client key): {e}")
                return Response({'error': f'Gemini error: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # --- Anthropic: hard-coded known models (no public list endpoint) ---
        elif provider == 'anthropic':
            cloud_models = [
                'claude-3-5-sonnet-latest',
                'claude-3-5-haiku-latest',
                'claude-3-opus-latest',
                'claude-3-sonnet-20240229',
                'claude-3-haiku-20240307',
            ]

        # --- OpenAI-compatible providers: GET {base_url}/models ---
        else:
            if not base_url:
                return Response({'error': f"No base URL known for provider '{provider}'. Set one in the settings.'"}, status=status.HTTP_400_BAD_REQUEST)
            try:
                url = f"{base_url.rstrip('/')}/models"
                headers = {'Authorization': f'Bearer {api_key}'}
                res = requests.get(url, headers=headers, timeout=(5, 20))
                res.raise_for_status()
                data = res.json()
                # OpenAI-style: { "data": [ {"id": "gpt-4o-mini"}, ...] }
                items = data.get('data', []) if isinstance(data, dict) else data
                for item in items:
                    model_id = ''
                    if isinstance(item, dict):
                        model_id = item.get('id') or item.get('model') or ''
                    elif isinstance(item, str):
                        model_id = item
                    if model_id:
                        cloud_models.append(model_id)
            except Exception as e:
                print(f"⚠️ Could not fetch models from {provider}: {e}")
                return Response({'error': f'Provider error: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        cloud_models = list(dict.fromkeys(cloud_models))
        return Response(
            {
                'models': cloud_models,
                'cloud_models': cloud_models,
                'local_models': [],
            },
            status=status.HTTP_200_OK
        )
