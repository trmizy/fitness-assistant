import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authRepository } from '../repositories/auth.repository';
import type { RegisterDto } from '../models/auth.models';

const ACCESS_TOKEN_SECRET =
  process.env.JWT_SECRET || 'access-secret-key-change-in-production';
const REFRESH_TOKEN_SECRET =
  process.env.JWT_REFRESH_SECRET || 'refresh-secret-key-change-in-production';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

function generateAccessToken(userId: string, role: string): string {
  return jwt.sign({ userId, role }, ACCESS_TOKEN_SECRET, {
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

export const authService = {
  async register(data: RegisterDto) {
    const existing = await authRepository.findUserByEmail(data.email);
    if (existing) throw { status: 400, message: 'Email already registered' };

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const user = await authRepository.createUser({
      email: data.email,
      password: hashedPassword,
      firstName: data.firstName,
      lastName: data.lastName,
      role: 'USER',
    });

    const accessToken = generateAccessToken(user.id, user.role);
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

    const accessToken = generateAccessToken(user.id, user.role);
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
