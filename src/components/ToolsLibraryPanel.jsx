import { useState } from "react";
import { ExternalLink, Download, FileText, FolderOpen, Plus, Search, Trash2, Copy, Edit2, Wrench, BookOpen, Keyboard, Lightbulb } from "lucide-react";
import { getToolsLibraryLinks, getToolsLibraryCommands, openToolsLibrary } from "../lib/toolsLibrary.js";
import { searchTools, filterToolsByCategory } from "../lib/toolsLibrary.js";
import { toolCategories, emptyToolDraft, createTool, getToolCategoryMeta } from "../lib/domain.js";

export function ToolsLibraryPanel({ tools = [], onDeleteTool, onToolsChange }) {
  const links = getToolsLibraryLinks();
  const commands = getToolsLibraryCommands();

  const [draft, setDraft] = useState({ ...emptyToolDraft });
  const [editingId, setEditingId] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showForm, setShowForm] = useState(false);

  const filteredTools = filterToolsByCategory(searchTools(tools, searchKeyword), categoryFilter);

  function updateDraft(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function resetDraft() {
    setDraft({ ...emptyToolDraft });
    setEditingId("");
  }

  function submitTool(event) {
    event.preventDefault();

    try {
      let newTools;

      if (editingId) {
        const tool = createTool(draft);
        newTools = tools.map((currentTool) =>
          currentTool.id === editingId
            ? { ...tool, id: editingId, createdAt: currentTool.createdAt || tool.createdAt }
            : currentTool,
        );
      } else {
        const tool = createTool(draft);
        newTools = [...tools, tool];
      }

      onToolsChange(newTools);
      resetDraft();
      setShowForm(false);
    } catch (error) {
      alert(error.message || "保存失败");
    }
  }

  function deleteTool(id) {
    if (confirm("确定要删除这个工具吗？")) {
      onDeleteTool(id);
    }
  }

  function editTool(tool) {
    setDraft({
      name: tool.name,
      path: tool.path,
      description: tool.description,
      category: tool.category,
    });
    setEditingId(tool.id);
    setShowForm(true);
  }

  function copyPath(path) {
    navigator.clipboard.writeText(path).then(() => {
      alert("路径已复制到剪贴板");
    });
  }

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

      {/* 工具管理区域 */}
      <section className="tools-section">
        <h3><Wrench size={18} />我的工具</h3>

        {/* 工具添加表单 */}
        {showForm && (
          <form className="tool-form" onSubmit={submitTool}>
            <label>
              工具名称
              <input
                value={draft.name}
                onChange={(e) => updateDraft("name", e.target.value)}
                placeholder="例如：打包脚本、备份工具"
                autoFocus
              />
            </label>

            <label>
              保存路径
              <input
                value={draft.path}
                onChange={(e) => updateDraft("path", e.target.value)}
                placeholder="例如：D:\tools\backup.sh 或 C:\Program Files\App\app.exe"
              />
            </label>

            <label>
              分类
              <select value={draft.category} onChange={(e) => updateDraft("category", e.target.value)}>
                {toolCategories.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              描述（可选）
              <textarea
                value={draft.description}
                onChange={(e) => updateDraft("description", e.target.value)}
                placeholder="说明这个工具的用途"
                rows={2}
              />
            </label>

            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={resetDraft}>
                取消
              </button>
              <button className="primary-button" type="submit">
                {editingId ? "保存修改" : "添加工具"}
              </button>
            </div>
          </form>
        )}

        {/* 搜索和过滤 */}
        <div className="tools-controls">
          <div className="search-box">
            <Search size={16} />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="搜索工具名称或路径..."
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="category-filter"
          >
            <option value="">全部分类</option>
            {toolCategories.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>

          {!showForm && (
            <button className="secondary-button" onClick={() => setShowForm(true)}>
              <Plus size={16} />
              添加工具
            </button>
          )}
        </div>

        {/* 工具列表 */}
        {filteredTools.length === 0 ? (
          <div className="empty-state">
            <p>{tools.length === 0 ? "还没有保存工具，点击上面的按钮添加吧" : "搜索没有找到匹配的工具"}</p>
          </div>
        ) : (
          <div className="tools-list">
            {filteredTools.map((tool) => (
              <article className="tool-item" key={tool.id}>
                <div className="tool-header">
                  <strong>{tool.name}</strong>
                  <span className="category-badge">{getToolCategoryMeta(tool.category).label}</span>
                </div>
                <code className="tool-path">{tool.path}</code>
                {tool.description && <p className="tool-description">{tool.description}</p>}
                <div className="tool-actions">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => copyPath(tool.path)}
                    title="复制路径"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => editTool(tool)}
                    title="编辑"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    onClick={() => deleteTool(tool.id)}
                    title="删除"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 快速访问 */}
      <section className="tools-section">
        <h3><BookOpen size={18} />快速访问</h3>
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

      {/* 命令行快速命令 */}
      <section className="tools-section">
        <h3><Keyboard size={18} />命令行快速命令</h3>
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

      {/* 使用提示 */}
      <section className="tools-section">
        <h3><Lightbulb size={18} />使用提示</h3>
        <ul className="tips-list">
          <li>在这里记录你常用工具的路径，再也不用担心忘记在哪了</li>
          <li>支持按工具名称、路径或描述搜索</li>
          <li>可以按分类筛选，快速定位工具</li>
          <li>一键复制路径，直接粘贴到需要的地方</li>
        </ul>
      </section>
    </div>
  );
}
