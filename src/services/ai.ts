import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY });

export interface ProjectAnalysis {
  mainLanguages: string[];
  techStack: string[];
  entryFiles: string[];
  summary: string;
}

export interface AIAnalysisResult {
  analysis: ProjectAnalysis | null;
  requestPayload?: any;
  responseText?: string | null;
}

export async function analyzeProjectFiles(files: string[]): Promise<AIAnalysisResult> {
  const requestPayload = {
    model: 'gemini-3-flash-preview',
    contents: `请作为一名资深的高级软件工程师，分析以下来自 GitHub 仓库的代码文件路径列表，并提供结构化的分析结果。
    
项目文件路径列表:
${files.join('\n')}

请仔细分析上述文件结构、命名约定和扩展名，推断出该项目的核心信息，并严格按照以下 JSON 格式返回结果：
{
  "mainLanguages": ["语言1", "语言2"], // 项目使用的主要编程语言
  "techStack": ["框架1", "库1", "工具1"], // 项目使用的核心框架、库和技术栈
  "entryFiles": ["src/index.ts", "main.py"], // 推测的项目主入口文件路径
  "summary": "用1-2句话简要总结这个项目的主要功能和用途。" // 项目功能总结
}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          mainLanguages: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "项目使用的主要编程语言",
          },
          techStack: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "项目使用的框架、库和技术栈标签",
          },
          entryFiles: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "可能的主入口文件路径 (例如: index.js, main.go, App.tsx, src/main.rs)",
          },
          summary: {
            type: Type.STRING,
            description: "一两句话简要总结这个项目的功能",
          }
        },
        required: ["mainLanguages", "techStack", "entryFiles", "summary"]
      }
    }
  };

  if (!files || files.length === 0) {
    console.warn("没有提供文件列表，跳过 AI 分析");
    return { analysis: null, requestPayload, responseText: null };
  }

  try {
    const response = await ai.models.generateContent(requestPayload);

    let analysis: ProjectAnalysis | null = null;
    if (response.text) {
      try {
        analysis = JSON.parse(response.text) as ProjectAnalysis;
      } catch (e) {
        console.error("Failed to parse JSON", e);
      }
    }
    return { analysis, requestPayload, responseText: response.text || null };
  } catch (error) {
    console.error("AI 分析项目失败:", error);
    return { analysis: null, requestPayload, responseText: String(error) };
  }
}
