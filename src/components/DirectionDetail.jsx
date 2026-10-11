import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, Trash2, Save, X } from 'lucide-react';
import { STYLES, GROUPS } from '@/lib/directions';
import { toast } from '@/components/ui/use-toast';

// 查看编辑删除已保存的项目方向
export default function DirectionDetail({ direction, onClose, onChanged }) {
  const [name, setName] = useState(direction.name);
  const [group, setGroup] = useState(direction.group);
  const [baseDir, setBaseDir] = useState(direction.base_direction || '');
  const [systemPrompt, setSystemPrompt] = useState(direction.system_prompt || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { toast({ title: '请填写方向名称', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      await base44.entities.Direction.update(direction.id, {
        name: name.trim(),
        group,
        base_direction: baseDir,
        system_prompt: systemPrompt
      });
      toast({ title: '已保存修改' });
      onChanged?.();
      onClose?.();
    } catch (e) {
      toast({ title: '保存失败', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('确定删除这个项目方向？此操作不可撤销。')) return;
    setDeleting(true);
    try {
      await base44.entities.Direction.delete(direction.id);
      toast({ title: '已删除' });
      onChanged?.();
      onClose?.();
    } catch (e) {
      toast({ title: '删除失败', description: e.message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const baseOptions = STYLES[group] || [];

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-primary">查看 / 编辑项目方向</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="方向名称"
        className="w-full px-2.5 py-1.5 text-xs rounded-md bg-background border border-border/60 focus:outline-none focus:border-primary"
      />
      <div className="flex gap-2">
        <select value={group} onChange={(e) => { setGroup(e.target.value); setBaseDir(''); }} className="flex-1 px-2 py-1.5 text-xs rounded-md bg-background border border-border/60 focus:outline-none">
          {GROUPS.filter(g => g.key !== 'viewpoint').map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
        <select value={baseDir} onChange={(e) => setBaseDir(e.target.value)} className="flex-1 px-2 py-1.5 text-xs rounded-md bg-background border border-border/60 focus:outline-none">
          <option value="">无（独立方向）</option>
          {baseOptions.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      <textarea
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        placeholder="项目专属优化要求（反推时保存的风格提示词）"
        className="w-full px-2.5 py-1.5 text-xs rounded-md bg-background border border-border/60 focus:outline-none focus:border-primary min-h-[120px] resize-y leading-relaxed"
      />
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleting} className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive">
          {deleting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
          删除
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1 bg-foreground text-background hover:bg-foreground/90">
          {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
          保存修改
        </Button>
      </div>
    </div>
  );
}