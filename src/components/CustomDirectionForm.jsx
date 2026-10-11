import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { STYLES } from '@/lib/directions';
import { Loader2, Check } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

// 新建项目专属优化方向：基于某个内置方向，叠加项目特定要求
export default function CustomDirectionForm({ group, onCreated }) {
  const styles = STYLES[group];
  const [name, setName] = useState('');
  const [baseDirection, setBaseDirection] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: '请输入方向名称', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      await base44.entities.Direction.create({
        name: name.trim(),
        group,
        base_direction: baseDirection,
        system_prompt: systemPrompt.trim()
      });
      toast({ title: '已创建项目方向' });
      setName('');
      setSystemPrompt('');
      onCreated?.();
    } catch (e) {
      toast({ title: '创建失败', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-border/60 p-3 flex flex-col gap-2 bg-muted/20">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="方向名称，如：我的科幻短片主角"
        className="h-8 text-sm"
      />
      <select
        value={baseDirection}
        onChange={(e) => setBaseDirection(e.target.value)}
        className="h-8 text-xs rounded-md border border-border/60 bg-background px-2"
      >
        <option value="">无（独立方向）</option>
        {styles.map((s) => (
          <option key={s.key} value={s.key}>基于：{s.label}</option>
        ))}
      </select>
      <Textarea
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        placeholder="项目专属优化要求（可选）：描述这个项目特定的人物气质、色调、镜头偏好等，系统会在基础方向上叠加这些要求，并随你的认可反馈持续学习"
        className="min-h-[70px] text-xs resize-none"
      />
      <Button onClick={handleSave} disabled={loading} size="sm" className="h-8">
        {loading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
        保存方向
      </Button>
    </div>
  );
}