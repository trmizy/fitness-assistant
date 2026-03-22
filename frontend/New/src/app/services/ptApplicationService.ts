import api from './api';

export interface PTApplicationCertificate {
  id?: string;
  certificateName: string;
  issuingOrganization: string;
  isCurrentlyValid: boolean;
  certificationStatus?: string; // 'Valid' | 'Expired' | 'Lifetime'
  issueDate?: string;
  expirationDate?: string;
  certificateFileUrl?: string;
}

export interface PTApplication {
  id: string;
  status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'NEEDS_MORE_INFO' | 'APPROVED' | 'REJECTED';
  phoneNumber?: string;
  nationalIdNumber?: string;
  currentAddress?: string;
  idCardFrontUrl?: string;
  idCardBackUrl?: string;
  portraitPhotoUrl?: string;
  yearsOfExperience?: string;
  educationBackground?: string;
  previousWorkExperience?: string;
  professionalBio?: string;
  mainSpecialties: string[];
  targetClientGroups: string[];
  primaryTrainingGoals: string[];
  trainingMethodsApproach?: string;
  portfolioUrl?: string;
  linkedinUrl?: string;
  websiteUrl?: string;
  socialLinks?: any;
  availabilityNotes?: string;
  availableTimeSlots?: any;
  serviceMode?: 'ONLINE' | 'OFFLINE' | 'HYBRID';
  operatingAreas: string[];
  desiredSessionPrice?: number;
  availableDays: string[];
  availableFrom?: string;
  availableUntil?: string;
  gymAffiliation?: string;
  packagePrice?: number;
  monthlyProgramPrice?: number;
  additionalPricingNotes?: string;
  otherReferences?: string;
  adminNote?: string;
  rejectionReason?: string;
  submittedAt?: string;
  reviewedAt?: string;
  approvedAt?: string;
  certificates: PTApplicationCertificate[];
  media: any[];
  user?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
  updatedAt: string;
  createdAt: string;
}

export const ptApplicationService = {
  getMe: async (): Promise<PTApplication | null> => {
    try {
      const { data } = await api.get('/pt-applications/me');
      return data;
    } catch (error) {
      console.error('Error fetching PT application:', error);
      return null;
    }
  },

  saveDraft: async (data: Partial<PTApplication>): Promise<PTApplication> => {
    const { data: response } = await api.post('/pt-applications/me/draft', data);
    return response;
  },

  submit: async (): Promise<PTApplication> => {
    const { data: response } = await api.post('/pt-applications/me/submit');
    return response;
  },

  uploadDocument: async (file: File): Promise<{ url: string; filename: string }> => {
    const formData = new FormData();
    formData.append('document', file);
    const { data } = await api.post('/pt-applications/me/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  // Admin methods
  listApplications: async (params: any = {}): Promise<PTApplication[]> => {
    const { data } = await api.get('/pt-applications/admin', { params });
    return data;
  },

  getById: async (id: string): Promise<PTApplication> => {
    const { data } = await api.get(`/pt-applications/admin/${id}`);
    return data;
  },

  reviewAction: async (id: string, action: string, payload: any = {}): Promise<PTApplication> => {
    const { data } = await api.post(`/pt-applications/admin/${id}/review/${action}`, payload);
    return data;
  }
};
