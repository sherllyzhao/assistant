// 工具库访问模块
// 提供统一的工具库数据访问接口
import { normalizeTools } from "./domain.js";

const TOOLS_LIBRARY_PATH = "../../../tools-library";
const TOOLS_STORAGE_KEY = "sherlly_tools_library";

/**
 * 从本地存储加载工具列表
 */
export function loadToolsData() {
  try {
    const stored = localStorage.getItem(TOOLS_STORAGE_KEY);
    return normalizeTools(stored ? JSON.parse(stored) : []);
  } catch (error) {
    console.error("Failed to load tools data:", error);
    return [];
  }
}

/**
 * 保存工具列表到本地存储
 */
export function saveToolsData(tools) {
  try {
    const normalized = normalizeTools(tools);
    localStorage.setItem(TOOLS_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch (error) {
    console.error("Failed to save tools data:", error);
    throw new Error("无法保存工具数据");
  }
}

/**
 * 搜索工具
 */
export function searchTools(tools, keyword) {
  const cleanKeyword = String(keyword || "").toLowerCase().trim();

  if (!cleanKeyword) {
    return tools;
  }

  return tools.filter((tool) => {
    const searchText = `${tool.name} ${tool.path} ${tool.description}`.toLowerCase();
    return searchText.includes(cleanKeyword);
  });
}

/**
 * 按分类过滤工具
 */
export function filterToolsByCategory(tools, category) {
  if (!category) {
    return tools;
  }

  return tools.filter((tool) => tool.category === category);
}

/**
 * 加载工具库元数据
 * @returns {Promise<Object>} 工具库配置对象
 */
export async function loadToolsLibrary() {
  try {
    // 在浏览器环境中，直接返回一个指向工具库的对象
    // 在实际应用中可以通过 Electron IPC 从主进程读取
    return {
      path: TOOLS_LIBRARY_PATH,
      readmeUrl: "tools-library/README.md",
      docsUrl: "tools-library/docs/TOOLS.md",
      toolsJsonUrl: "tools-library/tools.json",
      scriptUrl: "tools-library/get-tool.sh",
      message: "工具库已就绪",
    };
  } catch (error) {
    console.error("Failed to load tools library:", error);
    throw new Error("无法加载工具库");
  }
}

/**
 * 获取工具库文档链接
 * @returns {Object} 包含相关链接和说明的对象
 */
export function getToolsLibraryLinks() {
  return {
    readme: {
      label: "工具库首页",
      description: "查看所有工具分类和快速开始",
      path: "tools-library/README.md",
    },
    docs: {
      label: "详细文档",
      description: "学习如何添加和使用工具",
      path: "tools-library/docs/TOOLS.md",
    },
    json: {
      label: "工具数据库",
      description: "所有工具的结构化元数据",
      path: "tools-library/tools.json",
    },
    local: {
      label: "本地工具",
      description: "浏览本地存储的工具文件",
      path: "tools-library/local",
    },
  };
}

/**
 * 打开工具库
 * @param {string} section - 要打开的部分 ('readme' | 'docs' | 'local')
 */
export async function openToolsLibrary(section = "readme") {
  const links = getToolsLibraryLinks();
  const link = links[section];

  if (!link) {
    throw new Error(`Unknown tools library section: ${section}`);
  }

  // 在 Electron 环境中，可以通过 IPC 打开文件或文件夹
  if (window.sherlly?.openPath) {
    const fullPath = `${TOOLS_LIBRARY_PATH}/${link.path}`;
    return window.sherlly.openPath(fullPath);
  }

  // 在浏览器环境中，只能返回信息
  return {
    ok: false,
    message: `需要在 Electron 桌面环境中打开工具库`,
    path: link.path,
  };
}

/**
 * 获取快速访问命令
 */
export function getToolsLibraryCommands() {
  return [
    {
      command: "npm run tools:list",
      description: "列出所有工具",
    },
    {
      command: "npm run tools:search <keyword>",
      description: "搜索工具",
    },
    {
      command: "npm run tools:info <tool-id>",
      description: "查看工具详情",
    },
  ];
}
