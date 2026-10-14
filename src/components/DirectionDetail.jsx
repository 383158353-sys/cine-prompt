import React from 'react';
import { base44 } from '@/api/base44Client';
import CustomDirectionForm from '@/components/CustomDirectionForm';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';

export default function DirectionDetail({ direction, onClose, onChanged }) {
  const remove = async () => {
    if (!window.confirm('确定删除这个项目风格？')) return;
    try { await base44.entities.Direction.delete(direction.id); onChanged?.(); onClose?.(); }
    catch (error) { toast({ title: '删除失败', description: error.message, variant: 'destructive' }); }
  };
  return <div className="space-y-2">
    <CustomDirectionForm key={direction.id} direction={direction} onCreated={() => { onChanged?.(); onClose?.(); }} />
    <div className="flex gap-2"><Button variant="outline" size="sm" onClick={onClose}>关闭</Button><Button variant="outline" size="sm" onClick={remove} className="text-destructive">删除项目风格</Button></div>
  </div>;
}
