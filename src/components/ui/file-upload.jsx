"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import { Upload, File, X, Loader2 } from "lucide-react";

export function FileUpload({ onUploadSuccess, accept = "*/*", maxSize = 10 * 1024 * 1024, showUploadedFiles = true }) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [imageRetries, setImageRetries] = useState({});
  const [imageRefreshTimestamps, setImageRefreshTimestamps] = useState({});
  const fileInputRef = useRef(null);
  const { toast } = useToast();

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

  const getToken = () => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('auth_token');
    }
    return null;
  };

  const validateFile = (file) => {
    if (file.size > maxSize) {
      toast.error("File too large", {
        description: `File size must be less than ${Math.round(maxSize / (1024 * 1024))}MB`,
      });
      return false;
    }
    return true;
  };

  const handleImageError = (fileKey) => {
    const retryCount = imageRetries[fileKey] || 0;

    if (retryCount < 3) {
      setTimeout(() => {
        console.log(`🔄 Retrying image load for ${fileKey}, attempt ${retryCount + 1}`);
        setImageRetries(prev => ({
          ...prev,
          [fileKey]: retryCount + 1
        }));

        // Force reload the image by updating the refresh timestamp
        setImageRefreshTimestamps(prev => ({
          ...prev,
          [fileKey]: Date.now()
        }));
      }, 1000 * (retryCount + 1)); // Progressive delay: 1s, 2s, 3s
    } else {
      // Max retries reached, show error state
      const imgElement = document.getElementById(`img-preview-${fileKey}`);
      const errorElement = document.getElementById(`img-error-${fileKey}`);
      if (imgElement) imgElement.style.display = 'none';
      if (errorElement) errorElement.style.display = 'block';
    }
  };

  const uploadFile = async (file) => {
    if (!validateFile(file)) return;

    setUploading(true);
    const loadingToast = toast.loading(`Uploading ${file.name}...`);

    try {
      const token = getToken();
      if (!token) {
        throw new Error("Authentication required");
      }

      // Step 1: Get upload URL from our API
      const uploadUrlResponse = await fetch(
        `${apiUrl}/image/upload-url?filename=${encodeURIComponent(file.name)}&contentType=${encodeURIComponent(file.type)}`,
        {
          headers: {
            "Authorization": `Bearer ${token}`,
          },
        }
      );

      if (!uploadUrlResponse.ok) {
        const errorData = await uploadUrlResponse.json();
        throw new Error(errorData.message || "Failed to get upload URL");
      }

      const { uploadUrl, finalUrl, key } = await uploadUrlResponse.json();


      // Step 2: Upload file to the signed URL
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload file");
      }


      // Step 3: Make file public
      const makePublicResponse = await fetch(
        `${apiUrl}/image/make-public`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            key: key,
            filename: file.name
          }),
        }
      );

      if (!makePublicResponse.ok) {
        const errorData = await makePublicResponse.json();
        throw new Error(errorData.message || "Failed to make file public");
      }

      const publicData = await makePublicResponse.json();

      toast.dismiss(loadingToast);
      toast.success("File uploaded successfully", {
        description: `${file.name} has been uploaded and made public`,
      });

      // Add to uploaded files list with public URL
      const fileInfo = {
        filename: file.name,
        url: publicData.publicUrl || finalUrl,
        key: key,
        size: file.size,
        type: file.type,
        uploadedAt: new Date().toISOString(),
        isPublic: true,
      };

      setUploadedFiles(prev => [...prev, fileInfo]);

      // For images, initiate a gentle retry after a short delay to ensure the public URL is accessible
      if (file.type.startsWith('image/')) {
        setTimeout(() => {
          console.log('🔄 Initiating image refresh after upload completion');
          // Force image reload by updating timestamp
          setImageRefreshTimestamps(prev => ({
            ...prev,
            [key]: Date.now()
          }));
        }, 2000); // 2 second delay to allow for propagation
      }

      // Call the callback with file info
      if (onUploadSuccess) {
        onUploadSuccess(fileInfo);
      }

      setSelectedFile(null);
    } catch (error) {
      toast.dismiss(loadingToast);
      toast.error("Upload failed", {
        description: error.message || "Failed to upload file. Please try again.",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const file = files[0];
      setSelectedFile(file);
    }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      const file = files[0];
      setSelectedFile(file);
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      uploadFile(selectedFile);
    }
  };

  const clearSelection = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="w-full space-y-4">
      {/* Drag and Drop Area */}
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${isDragging
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50"
          } ${uploading ? "pointer-events-none opacity-50" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleFileSelect}
          className="hidden"
          disabled={uploading}
        />

        {selectedFile ? (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-3 p-4 bg-muted rounded-lg">
              <File className="h-8 w-8 text-muted-foreground" />
              <div className="flex-1 text-left">
                <p className="font-medium">{selectedFile.name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSelection}
                disabled={uploading}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Button onClick={handleUpload} disabled={uploading} className="w-full">
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload File
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Upload className="mx-auto h-12 w-12 text-muted-foreground" />
            <div>
              <p className="text-lg font-medium">
                Drag and drop your file here
              </p>
              <p className="text-sm text-muted-foreground">
                or click to browse files
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              Select File
            </Button>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Maximum file size: {Math.round(maxSize / (1024 * 1024))}MB
      </p>

      {/* Uploaded Files Display */}
      {showUploadedFiles && uploadedFiles.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Uploaded Files</h4>
          <div className="space-y-2">
            {uploadedFiles.map((file, index) => {
              const isImage = file.type?.startsWith('image/');

              return (
                <div key={index} className="p-3 bg-muted rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <File className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{file.filename}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </span>
                  </div>

                  {/* Image Preview */}
                  {isImage && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Preview:</p>
                      <div className="relative w-full max-w-md mx-auto">
                        <img
                          id={`img-preview-${file.key}`}
                          src={`${file.url}${imageRefreshTimestamps[file.key] ? `?t=${imageRefreshTimestamps[file.key]}` : ''}`}
                          alt={file.filename}
                          className="w-full h-auto max-h-48 object-contain rounded-lg border shadow-sm"
                          onError={() => handleImageError(file.key)}
                        />
                        <div
                          id={`img-error-${file.key}`}
                          className="hidden p-4 text-center text-sm text-muted-foreground bg-background border rounded-lg"
                        >
                          {imageRetries[file.key] >= 3 ? (
                            <>
                              Image preview not available
                              <br />
                              <span className="text-xs">Tried {imageRetries[file.key]} times</span>
                            </>
                          ) : imageRetries[file.key] > 0 ? (
                            <>
                              Loading image...
                              <br />
                              <span className="text-xs">Retry {imageRetries[file.key]}/3</span>
                            </>
                          ) : (
                            'Image preview not available'
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">S3 URL:</p>
                    <div className="p-2 bg-background rounded border">
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-800 break-all"
                      >
                        {file.url}
                      </a>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Key: <code className="bg-background px-1 py-0.5 rounded text-xs">{file.key}</code>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
} 