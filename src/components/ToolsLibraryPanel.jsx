import { ExternalLink, Download, FileText, FolderOpen } from "lucide-react";
import { getToolsLibraryLinks, getToolsLibraryCommands, openToolsLibrary } from "../lib/toolsLibrary.js";

export function ToolsLibraryPanel() {
  const links = getToolsLibraryLinks();
  const commands = getToolsLibraryCommands();

  async function handleOpenSection(section) {
    try {
      const result = await openToolsLibrary(section);
      if (!result?.ok) {
        alert(result?.message || "无法打开文件");
      }
    } catch (error) {
      alert(error.message || "打开失败");
    }
  }

  function copyCommand(command) {
    navigator.clipboard.writeText(command).then(() => {
      alert("命令已复制到剪贴板");
    });
  }

  return (
    <div className="tools-library-panel">
      <div className="section-toolbar">
        <div>
          <p className="eyebrow">Tools Library</p>
          <h2>工具库</h2>
        </div>
      </div>

      <section className="tools-section">
        <h3>📚 快速访问</h3>
        <div className="tools-grid">
          {Object.entries(links).map(([key, link]) => (
            <button
              key={key}
              className="tool-card"
              onClick={() => handleOpenSection(key)}
              type="button"
            >
              {key === "readme" && <FileText size={24} />}
              {key === "docs" && <FileText size={24} />}
              {key === "json" && <Download size={24} />}
              {key === "local" && <FolderOpen size={24} />}
              <div>
                <strong>{link.label}</strong>
                <span>{link.description}</span>
              </div>
              <ExternalLink size={16} />
            </button>
          ))}
        </div>
      </section>

      <section className="tools-section">
        <h3>⌨️ 命令行快速命令</h3>
        <div className="commands-list">
          {commands.map((item, index) => (
            <div key={index} className="command-item">
              <div>
                <code>{item.command}</code>
                <p>{item.description}</p>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => copyCommand(item.command)}
                title="复制命令"
              >
                <Download size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="tools-section">
        <h3>💡 使用提示</h3>
        <ul className="tips-list">
          <li>在秘书项目根目录运行命令行工具快速查询工具</li>
          <li>工具库支持按分类、关键词搜索和详细查询</li>
          <li>添加新工具时，更新 tools.json 和 README.md</li>
          <li>所有工具文件都通过 Git 版本控制管理</li>
        </ul>
      </section>

      <section className="tools-section">
        <h3>📂 项目结构</h3>
        <div className="structure-info">
          <code className="code-block">
{`tools-library/
├── README.md           # 可视化工具索引
├── tools.json          # 工具元数据库
├── get-tool.sh         # 查询脚本
├── docs/
│   └── TOOLS.md        # 详细文档
└── local/
    ├── scripts/        # Shell 脚本
    ├── cli-tools/      # CLI 工具
    └── utils/          # 实用工具`}
          </code>
        </div>
      </section>
    </div>
  );
}
