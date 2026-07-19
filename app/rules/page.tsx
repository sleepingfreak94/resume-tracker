"use client";

import { useState, useEffect } from "react";

interface Rule {
  id: number;
  rule_text: string;
  priority: number;
  is_active: number;
}

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRule, setNewRule] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchRules = async () => {
    const res = await fetch("/api/rules");
    const data = await res.json();
    setRules(data);
    setLoading(false);
  };

  useEffect(() => {
    let ignore = false;
    fetch("/api/rules")
      .then((res) => res.json())
      .then((data) => {
        if (!ignore) {
          setRules(data);
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleAdd = async () => {
    if (!newRule.trim()) return;
    setAdding(true);
    try {
      const priority = rules.length > 0 ? Math.max(...rules.map((r) => r.priority)) + 1 : 1;
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule_text: newRule.trim(), priority }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setNewRule("");
      await fetchRules();
      showMessage("success", "Rule added.");
    } catch (err) {
      showMessage("error", String(err));
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (rule: Rule) => {
    await fetch(`/api/rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: rule.is_active ? 0 : 1 }),
    });
    await fetchRules();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this rule?")) return;
    await fetch(`/api/rules/${id}`, { method: "DELETE" });
    await fetchRules();
  };

  const handleEdit = async (id: number) => {
    if (!editText.trim()) return;
    await fetch(`/api/rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule_text: editText.trim() }),
    });
    setEditingId(null);
    await fetchRules();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const activeCount = rules.filter((r) => r.is_active).length;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Tailoring Rules</h1>
        <p className="text-gray-400 mt-1 text-sm">
          These rules guide the Cursor AI agent when tailoring your resume for each job.{" "}
          <span className="text-indigo-400 font-medium">{activeCount} active</span> of {rules.length} rules.
        </p>
      </div>

      {message && (
        <div
          className={`px-4 py-3 rounded-lg text-sm ${
            message.type === "success"
              ? "bg-green-900/50 border border-green-800 text-green-300"
              : "bg-red-900/50 border border-red-800 text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Add new rule */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <label className="block text-sm font-medium text-gray-300 mb-2">Add New Rule</label>
        <div className="flex gap-3">
          <input
            value={newRule}
            onChange={(e) => setNewRule(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="e.g. Always include a strong summary tailored to the role"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-indigo-500 transition-colors"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newRule.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
          >
            {adding ? "Adding..." : "Add Rule"}
          </button>
        </div>
      </div>

      {/* Rules list */}
      <div className="space-y-2">
        {rules.length === 0 && (
          <div className="text-center py-12 text-gray-600">No rules yet. Add one above.</div>
        )}
        {rules.map((rule, idx) => (
          <div
            key={rule.id}
            className={`group flex items-start gap-3 p-4 rounded-xl border transition-colors ${
              rule.is_active
                ? "bg-gray-900 border-gray-800 hover:border-gray-700"
                : "bg-gray-900/40 border-gray-800/50 opacity-60"
            }`}
          >
            {/* Priority number */}
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-800 text-gray-400 text-xs flex items-center justify-center mt-0.5 font-mono">
              {idx + 1}
            </span>

            {/* Rule text / edit input */}
            <div className="flex-1 min-w-0">
              {editingId === rule.id ? (
                <div className="flex gap-2">
                  <input
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleEdit(rule.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    autoFocus
                    className="flex-1 bg-gray-800 border border-indigo-500 rounded-lg px-3 py-1.5 text-sm text-gray-100 outline-none"
                  />
                  <button onClick={() => handleEdit(rule.id)} className="text-xs text-indigo-400 hover:text-indigo-300 font-medium px-2">Save</button>
                  <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-300 px-2">Cancel</button>
                </div>
              ) : (
                <p className={`text-sm leading-relaxed ${rule.is_active ? "text-gray-200" : "text-gray-500"}`}>
                  {rule.rule_text}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => { setEditingId(rule.id); setEditText(rule.rule_text); }}
                className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-800 transition-colors"
                title="Edit"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={() => handleDelete(rule.id)}
                className="p-1.5 text-gray-500 hover:text-red-400 rounded-lg hover:bg-gray-800 transition-colors"
                title="Delete"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>

            {/* Toggle */}
            <button
              onClick={() => handleToggle(rule)}
              className={`flex-shrink-0 w-10 h-5 rounded-full transition-colors relative ${
                rule.is_active ? "bg-indigo-600" : "bg-gray-700"
              }`}
              title={rule.is_active ? "Disable" : "Enable"}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  rule.is_active ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      {rules.length > 0 && (
        <p className="text-xs text-gray-600">
          Rules are applied in the order listed above. Toggle rules on/off to include or exclude them from resume generation.
        </p>
      )}
    </div>
  );
}
