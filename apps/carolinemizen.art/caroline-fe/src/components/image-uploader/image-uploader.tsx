import { type FC, useCallback, useState } from 'react';
import styled from 'styled-components';
import { useAppConfig } from '../../hooks/use-app-config';

const Container = styled.div`
  width: 100%;
`;

const DropZone = styled.div<{ isDragging: boolean }>`
  border: 2px dashed ${(props) => (props.isDragging ? '#3498db' : '#ddd')};
  border-radius: 8px;
  padding: 3rem 2rem;
  text-align: center;
  background: ${(props) => (props.isDragging ? '#f0f8ff' : '#fafafa')};
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: #3498db;
    background: #f0f8ff;
  }
`;

const DropZoneText = styled.p`
  margin: 0 0 1rem;
  color: #666;
  font-size: 1rem;
`;

const DropZoneHint = styled.p`
  margin: 0;
  color: #999;
  font-size: 0.875rem;
`;

const HiddenInput = styled.input`
  display: none;
`;

const PreviewGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 1rem;
  margin-top: 1.5rem;
`;

const PreviewItem = styled.div`
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: #f5f5f5;
  border: 2px solid #e0e0e0;
`;

const PreviewImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const PreviewVideo = styled.video`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const PreviewOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;

  ${PreviewItem}:hover & {
    opacity: 1;
  }
`;

const RemoveButton = styled.button`
  background: #e74c3c;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background 0.2s;

  &:hover {
    background: #c0392b;
  }
`;

const ProgressBar = styled.div`
  width: 100%;
  height: 4px;
  background: #e0e0e0;
  border-radius: 2px;
  overflow: hidden;
  margin-top: 1rem;
`;

const ProgressFill = styled.div<{ progress: number }>`
  height: 100%;
  background: #3498db;
  width: ${(props) => props.progress}%;
  transition: width 0.3s;
`;

const ErrorMessage = styled.div`
  background: #f8d7da;
  color: #721c24;
  padding: 0.75rem;
  border-radius: 4px;
  margin-top: 1rem;
  font-size: 0.875rem;
`;

interface ImageFile {
  file: File;
  preview: string;
}

interface ImageUploaderProps {
  onUpload?: (files: File[]) => Promise<void>;
  maxFiles?: number;
  maxSizeMB?: number;
  accept?: string;
}

export const ImageUploader: FC<ImageUploaderProps> = ({
  onUpload,
  maxFiles: maxFilesProp,
  maxSizeMB: maxSizeMBProp,
  accept = 'image/*,video/*',
}) => {
  const { config } = useAppConfig();
  const [images, setImages] = useState<ImageFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Use config values if available, otherwise use props or defaults
  const maxFiles = maxFilesProp ?? config?.uploads.maxFiles ?? 10;
  const maxSizeMB = maxSizeMBProp ?? config?.uploads.maxFileSizeMB ?? 10;

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;

      setError(null);
      const fileArray = Array.from(files);

      // Validate file count
      if (images.length + fileArray.length > maxFiles) {
        setError(`Maximum ${maxFiles} files allowed`);
        return;
      }

      // Validate file sizes and types
      const validFiles: ImageFile[] = [];
      for (const file of fileArray) {
        // Allow images and videos
        if (
          !file.type.startsWith('image/') &&
          !file.type.startsWith('video/')
        ) {
          setError(`${file.name} is not a valid image or video file`);
          continue;
        }

        const sizeMB = file.size / 1024 / 1024;
        if (sizeMB > maxSizeMB) {
          setError(`${file.name} exceeds ${maxSizeMB}MB size limit`);
          continue;
        }

        validFiles.push({
          file,
          preview: URL.createObjectURL(file),
        });
      }

      setImages((prev) => [...prev, ...validFiles]);
    },
    [images.length, maxFiles, maxSizeMB],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
    },
    [handleFiles],
  );

  const handleRemove = useCallback((index: number) => {
    setImages((prev) => {
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].preview);
      newImages.splice(index, 1);
      return newImages;
    });
  }, []);

  const handleUpload = useCallback(async () => {
    if (!onUpload || images.length === 0) return;

    setUploading(true);
    setProgress(0);
    setError(null);

    try {
      const files = images.map((img) => img.file);
      await onUpload(files);

      // Clear images after successful upload
      for (const img of images) {
        URL.revokeObjectURL(img.preview);
      }
      setImages([]);
      setProgress(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [images, onUpload]);

  return (
    <Container>
      <DropZone
        isDragging={isDragging}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <DropZoneText>
          {isDragging
            ? 'Drop files here...'
            : 'Click to browse or drag and drop images/videos'}
        </DropZoneText>
        <DropZoneHint>
          Maximum {maxFiles} files, {maxSizeMB}MB each
        </DropZoneHint>
        <HiddenInput
          id="file-input"
          type="file"
          accept={accept}
          multiple
          onChange={handleInputChange}
        />
      </DropZone>

      {images.length > 0 && (
        <>
          <PreviewGrid>
            {images.map((img, index) => (
              <PreviewItem key={img.preview}>
                {img.file.type.startsWith('video/') ? (
                  <PreviewVideo
                    src={img.preview}
                    loop
                    autoPlay
                    muted
                    playsInline
                  />
                ) : (
                  <PreviewImage
                    src={img.preview}
                    alt={`Preview ${index + 1}`}
                  />
                )}
                <PreviewOverlay>
                  <RemoveButton
                    type="button"
                    onClick={() => handleRemove(index)}
                  >
                    Remove
                  </RemoveButton>
                </PreviewOverlay>
              </PreviewItem>
            ))}
          </PreviewGrid>

          {onUpload && (
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading}
              style={{
                marginTop: '1rem',
                padding: '0.75rem 2rem',
                background: '#3498db',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: uploading ? 'not-allowed' : 'pointer',
                fontSize: '1rem',
              }}
            >
              {uploading
                ? 'Uploading...'
                : `Upload ${images.length} image${images.length > 1 ? 's' : ''}`}
            </button>
          )}
        </>
      )}

      {uploading && (
        <ProgressBar>
          <ProgressFill progress={progress} />
        </ProgressBar>
      )}

      {error && <ErrorMessage>{error}</ErrorMessage>}
    </Container>
  );
};
