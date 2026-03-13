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

export interface EntryFileAnalysis {
  isEntryFile: boolean;
  reason: string;
}

export async function analyzeEntryFile(
  repoUrl: string,
  summary: string,
  languages: string[],
  filePath: string,
  fileContent: string
): Promise<{ analysis: EntryFileAnalysis | null, requestPayload: any, responseText: string | null }> {
  const requestPayload = {
    model: 'gemini-3-flash-preview',
    contents: `请作为一名资深的高级软件工程师，研判以下文件是否是该项目的真实入口文件。

项目 GitHub 地址: ${repoUrl}
项目简介: ${summary}
主要编程语言: ${languages.join(', ')}

当前研判文件路径: ${filePath}
文件内容:
\`\`\`
${fileContent}
\`\`\`

请仔细分析该文件的内容，判断它是否是整个项目的主入口文件（例如：启动服务器、挂载前端应用、初始化核心模块等）。
请严格按照以下 JSON 格式返回结果：
{
  "isEntryFile": true, // 或 false，表示是否是真实的入口文件
  "reason": "请给出详细的研判理由，解释为什么它是或不是入口文件。"
}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isEntryFile: {
            type: Type.BOOLEAN,
            description: "是否是项目的真实入口文件",
          },
          reason: {
            type: Type.STRING,
            description: "研判理由，解释为什么它是或不是入口文件",
          }
        },
        required: ["isEntryFile", "reason"]
      }
    }
  };

  try {
    const response = await ai.models.generateContent(requestPayload);

    let analysis: EntryFileAnalysis | null = null;
    if (response.text) {
      try {
        analysis = JSON.parse(response.text) as EntryFileAnalysis;
      } catch (e) {
        console.error("Failed to parse JSON for entry file analysis", e);
      }
    }
    return { analysis, requestPayload, responseText: response.text || null };
  } catch (error) {
    console.error("AI 研判入口文件失败:", error);
    return { analysis: null, requestPayload, responseText: String(error) };
  }
}

export interface SubFunctionAnalysis {
  name: string;
  file: string;
  description: string;
  drillDown: -1 | 0 | 1; // -1: no, 0: unsure, 1: yes
  children?: SubFunctionAnalysis[]; // For future recursive analysis
}

export interface EntryFunctionAnalysis {
  entryFunctionName: string;
  subFunctions: SubFunctionAnalysis[];
}

export async function analyzeSubFunctions(
  repoUrl: string,
  summary: string,
  entryFilePath: string,
  entryFileContent: string,
  allFiles: string[]
): Promise<{ analysis: EntryFunctionAnalysis | null, requestPayload: any, responseText: string | null }> {
  const requestPayload = {
    model: 'gemini-3-flash-preview',
    contents: `请作为一名资深的高级软件工程师，分析以下项目的入口文件，并识别出入口函数调用的关键子函数。

项目 GitHub 地址: ${repoUrl}
项目简介: ${summary}
项目文件列表:
${allFiles.slice(0, 1000).join('\n')}

入口文件路径: ${entryFilePath}
入口文件内容:
\`\`\`
${entryFileContent}
\`\`\`

请根据项目的简介和核心功能逻辑，研判该入口文件中调用的关键子函数（数量不超过20个）。
对于每一个子函数，请根据函数名、项目的文件列表和其他上下文研判：
1. 它可能定义在哪个文件中。
2. 给出函数的功能简介。
3. 研判其是否值得进一步下钻分析（-1表示不需要进一步下钻分析，0表示不确定，1表示需要进一步下钻分析）。

请严格按照以下 JSON 格式返回结果：
{
  "entryFunctionName": "入口函数名 (例如 main, App, init 等)",
  "subFunctions": [
    {
      "name": "子函数名",
      "file": "推测该子函数所在的文件路径",
      "description": "函数功能简介",
      "drillDown": 1 // -1, 0, 或 1
    }
  ]
}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          entryFunctionName: {
            type: Type.STRING,
            description: "入口函数名",
          },
          subFunctions: {
            type: Type.ARRAY,
            description: "调用的关键子函数列表，最多20个",
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "子函数名" },
                file: { type: Type.STRING, description: "推测该子函数所在的文件路径" },
                description: { type: Type.STRING, description: "函数功能简介" },
                drillDown: { type: Type.INTEGER, description: "是否值得进一步下钻分析 (-1, 0, 1)" }
              },
              required: ["name", "file", "description", "drillDown"]
            }
          }
        },
        required: ["entryFunctionName", "subFunctions"]
      }
    }
  };

  try {
    const response = await ai.models.generateContent(requestPayload);

    let analysis: EntryFunctionAnalysis | null = null;
    if (response.text) {
      try {
        analysis = JSON.parse(response.text) as EntryFunctionAnalysis;
      } catch (e) {
        console.error("Failed to parse JSON for sub-functions analysis", e);
      }
    }
    return { analysis, requestPayload, responseText: response.text || null };
  } catch (error) {
    console.error("AI 研判子函数失败:", error);
    return { analysis: null, requestPayload, responseText: String(error) };
  }
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
