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
  const [apiKey, setApiKey] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEYS.API_KEY) || '';
    }
    return '';
  });

  const [apiEndpoint, setApiEndpoint] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEYS.API_ENDPOINT) || 'https://grsai.dakka.com.cn/v1';
    }
    return 'https://grsai.dakka.com.cn/v1';
  });

  const [modelName, setModelName] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEYS.MODEL_NAME) || 'gemini-3.1-pro';
    }
    return 'gemini-3.1-pro';
  });

  const [prompt, setPrompt] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEYS.PROMPT) || '';
    }
    return '';
  });

  // 【2025-01修复】模型选择每次进入页面都默认 nano-banana-2，与画布页面行为一致
  // 不再从 localStorage 读取上次选择，确保每次进入都是 banana 2通道1模型
  const [model, setModel] = useState<string>('nano-banana-2');

  const [aspectRatio, setAspectRatio] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEYS.ASPECT_RATIO) || 'auto';
    }
    return 'auto';
  });

  const [resolution, setResolution] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEYS.RESOLUTION) || '2K';
    }
    return '2K';
  });

  const [count, setCount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      return parseInt(localStorage.getItem(STORAGE_KEYS.COUNT) || '1', 10);
    }
    return 1;
  });

  const [fullPowerMode, setFullPowerMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEYS.FULL_POWER_MODE) === 'true';
    }
    return true;
  });

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
