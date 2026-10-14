import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Check } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

// 新建项目专属优化方向：基于某个内置方向，叠加项目特定要求
export default function CustomDirectionForm({ onCreated, direction = null }) {
  const [name, setName] = useState(direction?.name || '');
  const [baseDirection, setBaseDirection] = useState(direction?.base_style || '');
  const [systemPrompt, setSystemPrompt] = useState(direction?.system_prompt || '');
  const [characterPrompt, setCharacterPrompt] = useState(direction?.character_prompt || '');
  const [scenePrompt, setScenePrompt] = useState(direction?.scene_prompt || '');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: '请输入项目风格名称', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const data = {
        name: name.trim(),
        group: 'project',
        base_style: baseDirection,
        system_prompt: systemPrompt.trim(),
        character_prompt: characterPrompt.trim(),
        scene_prompt: scenePrompt.trim()
      };
      const saved = direction ? await base44.entities.Direction.update(direction.id, data) : await base44.entities.Direction.create(data);
      toast({ title: '项目风格已保存' });
      setName('');
      setSystemPrompt('');
      onCreated?.(saved);
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
        placeholder="项目风格名称，如：我的科幻短片"
        className="h-8 text-sm"
      />
      <select
        value={baseDirection}
        onChange={(e) => setBaseDirection(e.target.value)}
        className="h-8 text-xs rounded-md border border-border/60 bg-background px-2"
      >
        <option value="">默认</option>
        <option value="realistic">真人写实</option>
        <option value="concept">概念设定</option>
      </select>
      <Textarea
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        placeholder="通用风格要求（可选）：色调、时代、气氛等。也可以直接描述人物和场景，使用时自动识别并分别应用。"
        className="min-h-[70px] text-xs resize-none"
      />
      <Textarea value={characterPrompt} onChange={(e) => setCharacterPrompt(e.target.value)} placeholder="人物专属要求（可选）：人物气质、肤色、服装、发型等，只用于人物" className="min-h-[70px] text-xs resize-y" />
      <Textarea value={scenePrompt} onChange={(e) => setScenePrompt(e.target.value)} placeholder="场景专属要求（可选）：建筑、空间、道具、材质等，只用于场景" className="min-h-[70px] text-xs resize-y" />
      <p className="text-[10px] text-muted-foreground">同一个项目风格在各栏目共享；根据当前主体、图片和具体要求选择对应部分。逻辑修复只影响指定局部。</p>
      <Button onClick={handleSave} disabled={loading} size="sm" className="h-8">
        {loading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
        保存项目风格
      </Button>
    </div>
  );
}
