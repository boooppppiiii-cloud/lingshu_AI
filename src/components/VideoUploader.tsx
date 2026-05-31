/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  compressVideoWithFfmpeg,
  ENCODE_PRESETS_ITERATION,
  inferVideoMimeType,
  isLikelyVideoFile,
  shouldCompressVideo,
  warmupFfmpeg,
  type CompressVideoOptions,
} from '../lib/videoCompressFfmpeg';

interface VideoUploaderProps {
  onUpload: (base64: string, mimeType: string, fileSize: number, blob?: Blob) => void;
  label?: string;
  /** 超过该字节数则在浏览器内压缩（默认 10MB） */
  compressAboveBytes?: number;
  /** 压缩档位：iteration = 360p、尽量 ≤4MB；默认 720p、≤10MB */
  compressPreset?: 'default' | 'iteration';
}

function readBlobAsBase64Body(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = reader.result as string;
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(new Error('读取视频数据失败'));
    reader.readAsDataURL(blob);
  });
}

const FOUR_MB = 4 * 1024 * 1024;

function resolveCompressOptions(
  compressAboveBytes: number,
  preset: 'default' | 'iteration',
): CompressVideoOptions {
  if (preset === 'iteration') {
    return {
      thresholdBytes: compressAboveBytes,
      targetMaxBytes: FOUR_MB,
      encodePresets: ENCODE_PRESETS_ITERATION,
    };
  }
  return { thresholdBytes: compressAboveBytes, targetMaxBytes: 10 * 1024 * 1024 };
}

export default function VideoUploader({
  onUpload,
  label = '上传参考视频',
  compressAboveBytes = 10 * 1024 * 1024,
  compressPreset = 'default',
}: VideoUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void warmupFfmpeg().catch((err) => {
      console.warn('ffmpeg warmup failed:', err);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (videoPreview?.startsWith('blob:')) {
        URL.revokeObjectURL(videoPreview);
      }
    };
  }, [videoPreview]);

  const handleFile = async (file: File) => {
    if (!file || !isLikelyVideoFile(file)) {
      window.alert('请上传视频文件（支持 mp4、mov、webm 等常见格式）');
      return;
    }

    const effectiveMime = inferVideoMimeType(file);

    try {
      const compressOpts = resolveCompressOptions(compressAboveBytes, compressPreset);
      if (shouldCompressVideo(file, compressOpts.thresholdBytes)) {
        setProcessing(true);
        setProgress(0);
        const { blob, mimeType } = await compressVideoWithFfmpeg(
          file,
          ({ overall }) => {
            setProgress(Math.round(overall * 100));
          },
          compressOpts,
        );
        const base64Body = await readBlobAsBase64Body(blob);
        if (videoPreview?.startsWith('blob:')) URL.revokeObjectURL(videoPreview);
        setVideoPreview(URL.createObjectURL(blob));
        onUpload(base64Body, mimeType, blob.size, blob);
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64 = e.target?.result as string;
          const base64Data = base64.split(',')[1];
          setVideoPreview(URL.createObjectURL(file));
          onUpload(base64Data, effectiveMime, file.size, file);
        };
        reader.readAsDataURL(file);
      }
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : '视频处理失败，请换较小文件或稍后重试');
    } finally {
      setProcessing(false);
      setProgress(0);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      void handleFile(e.target.files[0]);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      void handleFile(e.dataTransfer.files[0]);
    }
  };

  const clearVideo = () => {
    if (videoPreview?.startsWith('blob:')) {
      URL.revokeObjectURL(videoPreview);
    }
    setVideoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="w-full">
      <AnimatePresence mode="wait">
        {!videoPreview ? (
          <motion.div
            key="uploader"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`relative h-64 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center transition-all ${
              processing ? 'cursor-wait opacity-95' : 'cursor-pointer'
            } ${
              dragActive ? 'border-accent-blue bg-blue-50/50' : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
            }`}
            onDragEnter={processing ? undefined : handleDrag}
            onDragLeave={processing ? undefined : handleDrag}
            onDragOver={processing ? undefined : handleDrag}
            onDrop={processing ? undefined : handleDrop}
            onClick={() => {
              if (!processing) fileInputRef.current?.click();
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              disabled={processing}
              onChange={handleChange}
            />
            <div className="p-4 bg-accent-blue/10 rounded-full mb-4">
              <Upload className="w-8 h-8 text-accent-blue" />
            </div>
            <p className="text-lg font-bold text-primary-blue">{label}</p>
            <p className="text-sm text-slate-400 mt-2">拖拽视频文件或点击上传</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm text-center">
              {compressPreset === 'iteration'
                ? `大于 ${(compressAboveBytes / (1024 * 1024)).toFixed(0)}MB 时压缩至 360p，并尽量压到 ${(FOUR_MB / (1024 * 1024)).toFixed(0)}MB 以下再上传（首次会加载处理引擎）`
                : `大于 ${(compressAboveBytes / (1024 * 1024)).toFixed(0)}MB 时将在浏览器内压缩至 720p 后再上传（首次会加载处理引擎，请稍候）`}
            </p>

            {processing && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl bg-white/90 backdrop-blur-sm px-8">
                <p className="text-sm font-bold text-primary-blue mb-3">正在处理视频...</p>
                <div className="w-full max-w-xs h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                  <motion.div
                    className="h-full bg-accent-blue"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.2 }}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-2 font-mono tabular-nums">{progress}%</p>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="preview"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative rounded-2xl overflow-hidden bg-black aspect-video group"
          >
            <video src={videoPreview} controls className="w-full h-full" />
            <button
              type="button"
              onClick={clearVideo}
              className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/80 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
