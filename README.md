<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run the project locally

This project was originally created for Google AI Studio, and is now refactored to use a provider-agnostic AI configuration based on an OpenAI-compatible `base URL + api key + model`.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Configure the AI provider in `.env`:
   `AI_API_KEY`
   `GEMINIBASE_URL`
   `AI_MODEL`
3. Run the app:
   `npm run dev`

## Provider examples

- Gemini
  `GEMINIBASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`
  `AI_MODEL=gemini-2.5-flash`
- OpenAI
  `GEMINIBASE_URL=https://api.openai.com/v1`
  `AI_MODEL=gpt-4.1-mini`
- GLM
  `GEMINIBASE_URL=https://open.bigmodel.cn/api/paas/v4`
  `AI_MODEL=glm-4.5`
