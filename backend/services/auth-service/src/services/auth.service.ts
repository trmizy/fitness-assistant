import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { authRepository } from '../repositories/auth.repository';
import type { RegisterStartDto, RegisterVerifyDto } from '../models/auth.models';
import { sendOtpEmail } from './email.service';

const ACCESS_TOKEN_SECRET =
  process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production';
const REFRESH_TOKEN_SECRET =
  process.env.JWT_REFRESH_SECRET || 'refresh-secret-key-change-in-production';
const ACCESS_TOKEN_EXPIRY =
  (process.env.JWT_ACCESS_EXPIRY as SignOptions['expiresIn']) || '15m';
const REFRESH_TOKEN_EXPIRY =
  (process.env.JWT_REFRESH_EXPIRY as SignOptions['expiresIn']) || '7d';
const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);
const OTP_RESEND_SECONDS = Number(process.env.OTP_RESEND_SECONDS || 60);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

function generateAccessToken(userId: string, role: string, email: string): string {
  return jwt.sign({ userId, role, email }, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

function generateRefreshToken(userId: string): string {
  return jwt.sign({ userId }, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

function makeRefreshExpiry(): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  return expiresAt;
}

function makeOtpExpiry(): Date {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);
  return expiresAt;
}

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export const authService = {
  async register(data: RegisterStartDto) {
    const existing = await authRepository.findUserByEmail(data.email);
    if (existing) throw { status: 400, message: 'Email already registered' };

    const previous = await authRepository.findEmailVerificationByEmail(data.email);
    if (previous?.sentAt) {
      const secondsSinceLastSend =
        (Date.now() - previous.sentAt.getTime()) / 1000;
      if (secondsSinceLastSend < OTP_RESEND_SECONDS) {
        throw {
          status: 429,
          message: `OTP recently sent. Please wait ${Math.ceil(
            OTP_RESEND_SECONDS - secondsSinceLastSend,
          )}s`,
        };
      }
    }

    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const passwordHash = await bcrypt.hash(data.password, 10);
    const expiresAt = makeOtpExpiry();
    const sentAt = new Date();

    await authRepository.upsertEmailVerification({
      email: data.email,
      passwordHash,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      otpHash,
      expiresAt,
      sentAt,
    });

    const emailResult = await sendOtpEmail(
      data.email,
      otp,
      data.firstName,
      OTP_EXPIRY_MINUTES,
    );

    const response: {
      message: string;
      email: string;
      expiresInMinutes: number;
      devOtp?: string;
    } = {
      message: 'OTP sent',
      email: data.email,
      expiresInMinutes: OTP_EXPIRY_MINUTES,
    };

    if (!emailResult.delivered && process.env.NODE_ENV !== 'production') {
      response.devOtp = otp;
    }

    return response;
  },

  async verifyRegistration(data: RegisterVerifyDto) {
    const record = await authRepository.findEmailVerificationByEmail(data.email);
    if (!record) throw { status: 400, message: 'OTP not found' };

    if (record.expiresAt < new Date()) {
      throw { status: 400, message: 'OTP expired' };
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      throw { status: 429, message: 'OTP attempts exceeded' };
    }

    const otpHash = hashOtp(data.otp);
    if (otpHash !== record.otpHash) {
      await authRepository.incrementEmailVerificationAttempts(data.email);
      throw { status: 400, message: 'Invalid OTP' };
    }

    const existing = await authRepository.findUserByEmail(data.email);
    if (existing) {
      await authRepository.deleteEmailVerification(data.email);
      throw { status: 400, message: 'Email already registered' };
    }

    const user = await authRepository.createUser({
      email: record.email,
      password: record.passwordHash,
      firstName: record.firstName ?? undefined,
      lastName: record.lastName ?? undefined,
      role: 'USER',
    });

    await authRepository.deleteEmailVerification(data.email);

    const accessToken = generateAccessToken(user.id, user.role, user.email);
    const refreshToken = generateRefreshToken(user.id);
    await authRepository.createRefreshToken({
      token: refreshToken,
      userId: user.id,
      expiresAt: makeRefreshExpiry(),
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      accessToken,
      refreshToken,
    };
  },

  async login(email: string, password: string) {
    const user = await authRepository.findUserByEmail(email);
    if (!user) throw { status: 401, message: 'Invalid credentials' };

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) throw { status: 401, message: 'Invalid credentials' };

    const accessToken = generateAccessToken(user.id, user.role, user.email);
    const refreshToken = generateRefreshToken(user.id);
    await authRepository.createRefreshToken({
      token: refreshToken,
      userId: user.id,
      expiresAt: makeRefreshExpiry(),
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      accessToken,
      refreshToken,
    };
  },

  async refresh(refreshToken: string) {
    try {
      jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);
    } catch {
      throw { status: 401, message: 'Invalid refresh token' };
    }

    const storedToken = await authRepository.findRefreshToken(refreshToken);
    if (!storedToken) throw { status: 401, message: 'Refresh token not found' };

    if (storedToken.expiresAt < new Date()) {
      await authRepository.deleteRefreshToken(storedToken.id);
      throw { status: 401, message: 'Refresh token expired' };
    }

    const accessToken = generateAccessToken(
      storedToken.user.id,
      storedToken.user.role,
      storedToken.user.email,
    );
    const newRefreshToken = generateRefreshToken(storedToken.user.id);
    await authRepository.deleteRefreshToken(storedToken.id);
    await authRepository.createRefreshToken({
      token: newRefreshToken,
      userId: storedToken.user.id,
      expiresAt: makeRefreshExpiry(),
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      userId: storedToken.user.id,
    };
  },

  async logout(refreshToken: string): Promise<string | undefined> {
    const deleted = await authRepository.deleteRefreshTokenByValue(refreshToken);
    if (deleted.count > 0) {
      try {
        const decoded: any = jwt.decode(refreshToken);
        if (decoded?.userId) return decoded.userId;
      } catch {
        // ignore decode errors
      }
    }
    return undefined;
  },

  async verifyToken(token: string) {
    let decoded: any;
    try {
      decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
    } catch {
      throw { status: 401, message: 'Invalid token' };
    }

    const user = await authRepository.findUserById(decoded.userId);
    if (!user) throw { status: 401, message: 'User not found' };
    return user;
  },
};
