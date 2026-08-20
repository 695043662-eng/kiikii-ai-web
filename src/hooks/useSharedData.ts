'use client';

import { useState, useEffect } from 'react';
import { safeSetItem } from '@/lib/safe-storage';

// 数据存储键
const STORAGE_KEYS = {
  API_KEY: 'pineapple-ai-api-key',
  API_ENDPOINT: 'pineapple-ai-api-endpoint',
  MODEL_NAME: 'pineapple-ai-model-name',
  PROMPT: 'pineapple-ai-prompt',
  MODEL: 'pineapple-ai-model',
  ASPECT_RATIO: 'pineapple-ai-aspect-ratio',
  RESOLUTION: 'pineapple-ai-resolution',
  COUNT: 'pineapple-ai-count',
  FULL_POWER_MODE: 'pineapple-ai-full-power-mode',
};

export function useSharedData() {
  // #860 修复 React #418 Hydration Mismatch：
  // useState 初始化器中禁止使用 typeof window / localStorage
  // 初始值用默认值，挂载后 useEffect 恢复 localStorage 记忆值
  const [apiKey, setApiKey] = useState<string>('');

  const [apiEndpoint, setApiEndpoint] = useState<string>('https://grsai.dakka.com.cn/v1');

  const [modelName, setModelName] = useState<string>('gemini-3.1-pro');

  const [prompt, setPrompt] = useState<string>('');

  // 【#277 修复】模型选择默认 GPT Image 2
  // 与 AIGeneratorContext 保持一致
  const [model, setModel] = useState<string>('gpt-image-2');

  const [aspectRatio, setAspectRatio] = useState<string>('auto');

  const [resolution, setResolution] = useState<string>('2K');

  const [count, setCount] = useState<number>(1);

  const [fullPowerMode, setFullPowerMode] = useState<boolean>(true);

  // #860: 挂载后从 localStorage 恢复用户偏好（SSR 与 Client 初始渲染一致）
  useEffect(() => {
    const savedApiKey = localStorage.getItem(STORAGE_KEYS.API_KEY);
    if (savedApiKey) setApiKey(savedApiKey);

    const savedEndpoint = localStorage.getItem(STORAGE_KEYS.API_ENDPOINT);
    if (savedEndpoint) setApiEndpoint(savedEndpoint);

    const savedModelName = localStorage.getItem(STORAGE_KEYS.MODEL_NAME);
    if (savedModelName) setModelName(savedModelName);

    const savedPrompt = localStorage.getItem(STORAGE_KEYS.PROMPT);
    if (savedPrompt) setPrompt(savedPrompt);

    const savedModel = localStorage.getItem(STORAGE_KEYS.MODEL);
    if (savedModel) setModel(savedModel);

    const savedAspectRatio = localStorage.getItem(STORAGE_KEYS.ASPECT_RATIO);
    if (savedAspectRatio) setAspectRatio(savedAspectRatio);

    const savedResolution = localStorage.getItem(STORAGE_KEYS.RESOLUTION);
    if (savedResolution) setResolution(savedResolution);

    const savedCount = localStorage.getItem(STORAGE_KEYS.COUNT);
    if (savedCount) setCount(parseInt(savedCount, 10) || 1);

    const savedFullPower = localStorage.getItem(STORAGE_KEYS.FULL_POWER_MODE);
    if (savedFullPower !== null) setFullPowerMode(savedFullPower === 'true');
  }, []);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.API_KEY, apiKey);
  }, [apiKey]);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.API_ENDPOINT, apiEndpoint);
  }, [apiEndpoint]);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.MODEL_NAME, modelName);
  }, [modelName]);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.PROMPT, prompt);
  }, [prompt]);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.MODEL, model);
  }, [model]);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.ASPECT_RATIO, aspectRatio);
  }, [aspectRatio]);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.RESOLUTION, resolution);
  }, [resolution]);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.COUNT, count.toString());
  }, [count]);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.FULL_POWER_MODE, fullPowerMode.toString());
  }, [fullPowerMode]);

  return {
    apiKey,
    setApiKey,
    apiEndpoint,
    setApiEndpoint,
    modelName,
    setModelName,
    prompt,
    setPrompt,
    model,
    setModel,
    aspectRatio,
    setAspectRatio,
    resolution,
    setResolution,
    count,
    setCount,
    fullPowerMode,
    setFullPowerMode,
  };
}
