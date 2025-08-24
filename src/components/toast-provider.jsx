"use client";

import * as React from "react";
import { toast } from "sonner";

const ToastContext = React.createContext({});

export function ToastProvider({ children }) {
  const showToast = React.useCallback(() => ({
    success: (message, options = {}) => {
      toast.success(message, {
        duration: 4000,
        ...options,
      });
    },
    error: (message, options = {}) => {
      toast.error(message, {
        duration: 5000,
        ...options,
      });
    },
    info: (message, options = {}) => {
      toast.info(message, {
        duration: 4000,
        ...options,
      });
    },
    warning: (message, options = {}) => {
      toast.warning(message, {
        duration: 4000,
        ...options,
      });
    },
    loading: (message, options = {}) => {
      return toast.loading(message, {
        duration: Infinity,
        ...options,
      });
    },
    dismiss: (toastId) => {
      toast.dismiss(toastId);
    },
    promise: (promise, messages, options = {}) => {
      return toast.promise(promise, messages, {
        duration: 4000,
        ...options,
      });
    },
  }), []);

  const contextValue = React.useMemo(() => ({
    toast: showToast(),
  }), [showToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }

  return context;
} 