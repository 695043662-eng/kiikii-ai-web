'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Upload, Trash2, User, Loader2, Plus, X, CheckCircle } from 'lucide-react';

interface Character {
  id: string;
  name: string;
  character_id: string;
  source_type: string;
  source_video: string;
  thumbnail: string | null;
  created_at: string;
}

interface CharacterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (character: Character) => void;
}

export default function CharacterModal({ isOpen, onClose, onSelect }: CharacterModalProps) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  
  // 创建角色状态
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createStep, setCreateStep] = useState<'upload' | 'info' | 'creating'>('upload');
  const [characterName, setCharacterName] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(3);
  const [creating, setCreating] = useState(false);

  const videoInputRef = useRef<HTMLInputElement>(null);

  // 加载角色列表
  const loadCharacters = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/characters');
      const data = await response.json();
      
      if (data.success) {
        setCharacters(data.characters || []);
      }
    } catch (error) {
      console.error('加载角色失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadCharacters();
    }
  }, [isOpen]);

  // 处理视频文件选择
  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      alert('请选择视频文件');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      alert('视频文件不能超过 50MB');
      return;
    }

    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoPreview(url);
    setCreateStep('info');
  };

  // 上传视频到服务器
  const uploadVideo = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        try {
          const response = await fetch('/api/upload-reference', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64Image: base64 }),
          });
          const data = await response.json();
          if (data.url) {
            resolve(data.url);
          } else {
            reject(new Error('上传失败'));
          }
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
    });
  };

  // 创建角色
  const handleCreateCharacter = async () => {
    if (!characterName.trim()) {
      alert('请输入角色名称');
      return;
    }

    if (!videoFile && !videoUrl) {
      alert('请上传视频或输入视频URL');
      return;
    }

    setCreating(true);
    setCreateStep('creating');

    try {
      let finalVideoUrl = videoUrl;
      
      if (videoFile) {
        finalVideoUrl = await uploadVideo(videoFile);
      }

      const response = await fetch('/api/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: characterName.trim(),
          url: finalVideoUrl,
          timestamps: `${startTime},${endTime}`,
          sourceType: videoFile ? 'upload' : 'video',
          sourceVideo: finalVideoUrl,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setCharacters([data.character, ...characters]);
        
        setTimeout(() => {
          setShowCreateModal(false);
          setCreateStep('upload');
          setCharacterName('');
          setVideoUrl('');
          setVideoFile(null);
          setVideoPreview(null);
          setStartTime(0);
          setEndTime(3);
        }, 1500);
      } else {
        alert(data.error || '创建失败');
        setCreateStep('info');
      }
    } catch (error) {
      console.error('创建角色失败:', error);
      alert('创建失败，请重试');
      setCreateStep('info');
    } finally {
      setCreating(false);
    }
  };

  // 删除角色
  const handleDeleteCharacter = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个角色吗？')) return;

    try {
      const response = await fetch(`/api/characters?id=${id}`, {
        method: 'DELETE',
      });
      const data = await response.json();

      if (data.success) {
        setCharacters(characters.filter(c => c.id !== id));
      } else {
        alert(data.error || '删除失败');
      }
    } catch (error) {
      console.error('删除角色失败:', error);
      alert('删除失败');
    }
  };

  // 重置创建状态
  const resetCreateState = () => {
    setShowCreateModal(false);
    setCreateStep('upload');
    setCharacterName('');
    setVideoUrl('');
    setVideoFile(null);
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
      setVideoPreview(null);
    }
    setStartTime(0);
    setEndTime(3);
  };

  // 格式化日期
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      {/* 主弹窗 - 大尺寸 */}
      <div 
        className="bg-white dark:bg-[#1E1F2F] rounded-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">选择角色</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              选择一个角色，生成视频时保持角色一致性
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCreateModal(true)}
              className="border-[rgb(139,158,232)] text-[rgb(139,158,232)] hover:bg-[rgb(139,158,232)]/10"
            >
              <Plus className="w-4 h-4 mr-1" />
              创建角色
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* 角色列表 */}
        <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(85vh - 80px)' }}>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-10 h-10 text-[rgb(139,158,232)] animate-spin mb-4" />
              <p className="text-gray-500 dark:text-gray-400">加载中...</p>
            </div>
          ) : characters.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <User className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
              <p className="text-gray-500 dark:text-gray-400">暂无角色</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-2 text-center max-w-sm">
                上传视频创建角色，在生成视频时保持角色一致性
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setShowCreateModal(true)}
              >
                <Plus className="w-4 h-4 mr-2" />
                创建第一个角色
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {characters.map((character) => (
                <Card 
                  key={character.id} 
                  className="overflow-hidden hover:shadow-lg transition-all cursor-pointer hover:ring-2 hover:ring-[rgb(139,158,232)]/50"
                  onClick={() => {
                    onSelect(character);
                    onClose();
                  }}
                >
                  {/* 缩略图/视频 */}
                  <div className="aspect-square bg-gray-100 dark:bg-gray-800 relative">
                    {character.thumbnail ? (
                      <img src={character.thumbnail} alt={character.name} className="w-full h-full object-cover" />
                    ) : character.source_video ? (
                      <video src={character.source_video} className="w-full h-full object-cover" muted />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <User className="w-12 h-12 text-gray-300 dark:text-gray-600" />
                      </div>
                    )}
                    <div className="absolute top-2 right-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 w-7 p-0 bg-red-500/80 hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => handleDeleteCharacter(e, character.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  
                  {/* 信息 */}
                  <div className="p-2.5">
                    <h3 className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                      {character.name}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-mono truncate">
                      @{character.character_id}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 创建角色小弹窗 */}
      {showCreateModal && (
        <div 
          className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40"
          onClick={resetCreateState}
        >
          <Card 
            className="w-full max-w-lg mx-4 p-6 bg-white dark:bg-[#1E1F2F]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">创建角色</h3>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={resetCreateState}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            {createStep === 'upload' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  上传包含角色(人物/动物等)的短视频，系统将提取角色特征用于后续视频生成。
                </p>
                
                {/* 上传视频按钮 */}
                <div
                  className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center cursor-pointer hover:border-[rgb(139,158,232)] transition-colors"
                  onClick={() => videoInputRef.current?.click()}
                >
                  <Upload className="w-12 h-12 mx-auto text-gray-400 mb-3" />
                  <p className="text-gray-600 dark:text-gray-400">点击上传视频</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">支持 MP4, MOV 等格式，最大 50MB</p>
                </div>
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleVideoSelect}
                  className="hidden"
                />

                <div className="text-center text-gray-400 dark:text-gray-500">或</div>

                {/* 视频URL输入 */}
                <div>
                  <Label>视频URL</Label>
                  <Input
                    placeholder="https://example.com/video.mp4"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    className="mt-1"
                  />
                </div>

                <Button
                  className="w-full bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] hover:from-[rgb(120,140,220)] hover:to-[rgb(212,160,170)] text-white"
                  disabled={!videoUrl && !videoFile}
                  onClick={() => videoUrl && setCreateStep('info')}
                >
                  下一步
                </Button>
              </div>
            )}

            {createStep === 'info' && (
              <div className="space-y-4">
                {/* 视频预览 */}
                {videoPreview && (
                  <div className="aspect-video bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden">
                    <video src={videoPreview} controls className="w-full h-full" />
                  </div>
                )}

                {/* 角色名称 */}
                <div>
                  <Label>角色名称</Label>
                  <Input
                    placeholder="例如：我家猫咪、小明、可爱的狗狗"
                    value={characterName}
                    onChange={(e) => setCharacterName(e.target.value)}
                    className="mt-1"
                  />
                </div>

                {/* 时间范围 */}
                <div>
                  <Label>选择时间范围（秒）</Label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    选择视频中角色清晰出现的时间段，最多3秒
                  </p>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Label className="text-xs text-gray-500">开始</Label>
                      <Input
                        type="number"
                        min={0}
                        max={endTime - 1}
                        value={startTime}
                        onChange={(e) => setStartTime(parseInt(e.target.value) || 0)}
                        className="mt-1"
                      />
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs text-gray-500">结束</Label>
                      <Input
                        type="number"
                        min={startTime + 1}
                        max={startTime + 3}
                        value={endTime}
                        onChange={(e) => setEndTime(parseInt(e.target.value) || 3)}
                        className="mt-1"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setCreateStep('upload')}>
                    上一步
                  </Button>
                  <Button
                    className="flex-1 bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] hover:from-[rgb(120,140,220)] hover:to-[rgb(212,160,170)] text-white"
                    disabled={!characterName.trim()}
                    onClick={handleCreateCharacter}
                  >
                    创建角色
                  </Button>
                </div>
              </div>
            )}

            {createStep === 'creating' && (
              <div className="flex flex-col items-center justify-center py-8">
                {creating ? (
                  <>
                    <Loader2 className="w-12 h-12 text-[rgb(139,158,232)] animate-spin mb-4" />
                    <p className="text-gray-600 dark:text-gray-400">正在创建角色...</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">这可能需要几秒钟</p>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-12 h-12 text-green-500 mb-4" />
                    <p className="text-gray-900 dark:text-white font-medium">角色创建成功！</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">现在可以在视频生成中使用这个角色了</p>
                  </>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
