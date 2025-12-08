export type Member = {
  name: string;
};

export type ChecklistItem = {
  note: string;
  prUrl: string;
  author: string;
};

export type PrChecklistSource = {
  number: number;
  body: string;
  author: string;
  url: string;
  mergedAt?: string | null;
};

export type ServiceAccountAuth = {
  type: "service-account";
  keyBase64: string;
};

export type OidcAuth = {
  type: "oidc";
  workloadIdentityProvider: string;
  serviceAccountEmail: string;
};

export type OAuthRefreshTokenAuth = {
  type: "oauth";
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export type GoogleAuthConfig = ServiceAccountAuth | OidcAuth | OAuthRefreshTokenAuth;
