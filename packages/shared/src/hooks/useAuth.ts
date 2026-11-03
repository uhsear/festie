import { useAuthStore } from '../stores/authStore';
import {
  LoginRequest,
  RegisterRequest,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  AvatarResponse,
  ProviderName,
  ProviderCredentialBody,
  ProviderSignInResult,
  ProviderSignupCompleteRequest,
} from '../types';
import type { AvatarUploadFile } from '../utils/avatarFile';

export interface UseAuthReturn {
  login: (request: LoginRequest) => Promise<{ reactivated: boolean }>;
  register: (request: RegisterRequest) => Promise<{ emailVerificationSent: boolean }>;
  signInWithProvider: (provider: ProviderName, body: ProviderCredentialBody) => Promise<ProviderSignInResult>;
  completeProviderSignup: (request: ProviderSignupCompleteRequest) => Promise<{ emailVerificationSent: boolean }>;
  logout: () => Promise<void>;
  forgotPassword: (request: ForgotPasswordRequest) => Promise<void>;
  changePassword: (request: ChangePasswordRequest) => Promise<void>;
  uploadAvatar: (file: AvatarUploadFile) => Promise<AvatarResponse>;
  removeAvatar: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function useAuth(): UseAuthReturn {
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);
  const signInWithProvider = useAuthStore((state) => state.signInWithProvider);
  const completeProviderSignup = useAuthStore((state) => state.completeProviderSignup);
  const logout = useAuthStore((state) => state.logout);
  const forgotPassword = useAuthStore((state) => state.forgotPassword);
  const changePassword = useAuthStore((state) => state.changePassword);
  const uploadAvatar = useAuthStore((state) => state.uploadAvatar);
  const removeAvatar = useAuthStore((state) => state.removeAvatar);
  const isLoading = useAuthStore((state) => state.isLoading);
  const error = useAuthStore((state) => state.error);

  return {
    login,
    register,
    signInWithProvider,
    completeProviderSignup,
    logout,
    forgotPassword,
    changePassword,
    uploadAvatar,
    removeAvatar,
    isLoading,
    error,
  };
}
