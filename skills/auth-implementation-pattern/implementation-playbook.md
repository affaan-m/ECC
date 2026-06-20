# Authentication and Authorization Implementation Patterns Implementation Playbook

This file contains detailed patterns, checklists, and code samples referenced by the skill.

## Core Concepts

### 1. Authentication vs Authorization

**Authentication (AuthN)**: Who are you?
- Verifying identity (username/password, OAuth, biometrics)
- Issuing credentials (sessions, tokens)
- Managing login/logout

**Authorization (AuthZ)**: What can you do?
- Permission checking
- Role-based access control (RBAC)
- Resource ownership validation
- Policy enforcement

### 2. Authentication Strategies

**Session-Based:**
- Server stores session state
- Session ID in cookie
- Traditional, simple, stateful

**Token-Based (JWT):**
- Stateless, self-contained
- Scales horizontally
- Can store claims

**OAuth2/OpenID Connect:**
- Delegate authentication
- Social login (Google, GitHub)
- Enterprise SSO

## JWT Authentication

### Pattern 1: JWT Implementation

```typescript
// JWT structure: header.payload.signature
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

interface JWTPayload {
    userId: string;
    email: string;
    role: string;
    iat: number;
    exp: number;
}

// Generate JWT
function generateTokens(userId: string, email: string, role: string) {
    const accessToken = jwt.sign(
        { userId, email, role },
        process.env.JWT_SECRET!,
        { expiresIn: '15m' }  // Short-lived
    );

    const refreshToken = jwt.sign(
        { userId },
        process.env.JWT_REFRESH_SECRET!,
        { expiresIn: '7d' }  // Long-lived
    );

    return { accessToken, refreshToken };
}

// Verify JWT
function verifyToken(token: string): JWTPayload {
    try {
        return jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw new Error('Token expired');
        }
        if (error instanceof jwt.JsonWebTokenError) {
            throw new Error('Invalid token');
        }
        throw error;
    }
}

// Middleware
function authenticate(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    try {
        const payload = verifyToken(token);
        req.user = payload;  // Attach user to request
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// Usage
app.get('/api/profile', authenticate, (req, res) => {
    res.json({ user: req.user });
});
```

### Pattern 2: Refresh Token Flow

```typescript
interface StoredRefreshToken {
    token: string;
    userId: string;
    expiresAt: Date;
    createdAt: Date;
}

class RefreshTokenService {
    // Store refresh token in database
    async storeRefreshToken(userId: string, refreshToken: string) {
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.refreshTokens.create({
            token: await hash(refreshToken),  // Hash before storing
            userId,
            expiresAt,
        });
    }

    // Refresh access token
    async refreshAccessToken(refreshToken: string) {
        // Verify refresh token
        let payload;
        try {
            payload = jwt.verify(
                refreshToken,
                process.env.JWT_REFRESH_SECRET!
            ) as { userId: string };
        } catch {
            throw new Error('Invalid refresh token');
        }

        // Check if token exists in database
        const storedToken = await db.refreshTokens.findOne({
            where: {
                token: await hash(refreshToken),
                userId: payload.userId,
                expiresAt: { $gt: new Date() },
            },
        });

        if (!storedToken) {
            throw new Error('Refresh token not found or expired');
        }

        // Get user
        const user = await db.users.findById(payload.userId);
        if (!user) {
            throw new Error('User not found');
        }

        // Generate new access token
        const accessToken = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET!,
            { expiresIn: '15m' }
        );

        return { accessToken };
    }

    // Revoke refresh token (logout)
    async revokeRefreshToken(refreshToken: string) {
        await db.refreshTokens.deleteOne({
            token: await hash(refreshToken),
        });
    }

    // Revoke all user tokens (logout all devices)
    async revokeAllUserTokens(userId: string) {
        await db.refreshTokens.deleteMany({ userId });
    }
}

// API endpoints
app.post('/api/auth/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    try {
        const { accessToken } = await refreshTokenService
            .refreshAccessToken(refreshToken);
        res.json({ accessToken });
    } catch (error) {
        res.status(401).json({ error: 'Invalid refresh token' });
    }
});

app.post('/api/auth/logout', authenticate, async (req, res) => {
    const { refreshToken } = req.body;
    await refreshTokenService.revokeRefreshToken(refreshToken);
    res.json({ message: 'Logged out successfully' });
});
```

## Session-Based Authentication

### Pattern 1: Express Session

```typescript
import session from 'express-session';
import RedisStore from 'connect-redis';
import { createClient } from 'redis';

// Setup Redis for session storage
const redisClient = createClient({
    url: process.env.REDIS_URL,
});
await redisClient.connect();

app.use(
    session({
        store: new RedisStore({ client: redisClient }),
        secret: process.env.SESSION_SECRET!,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',  // HTTPS only
            httpOnly: true,  // No JavaScript access
            maxAge: 24 * 60 * 60 * 1000,  // 24 hours
            sameSite: 'strict',  // CSRF protection
        },
    })
);

// Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    const user = await db.users.findOne({ email });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Store user in session
    req.session.userId = user.id;
    req.session.role = user.role;

    res.json({ user: { id: user.id, email: user.email, role: user.role } });
});

// Session middleware
function requireAuth(req: Request, res: Response, next: NextFunction) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}

// Protected route
app.get('/api/profile', requireAuth, async (req, res) => {
    const user = await db.users.findById(req.session.userId);
    res.json({ user });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.clearCookie('connect.sid');
        res.json({ message: 'Logged out successfully' });
    });
});
```

## OAuth2 / Social Login

### Pattern 1: OAuth2 with Passport.js

```typescript
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';

// Google OAuth
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            callbackURL: '/api/auth/google/callback',
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                // Find or create user
                let user = await db.users.findOne({
                    googleId: profile.id,
                });

                if (!user) {
                    user = await db.users.create({
                        googleId: profile.id,
                        email: profile.emails?.[0]?.value,
                        name: profile.displayName,
                        avatar: profile.photos?.[0]?.value,
                    });
                }

                return done(null, user);
            } catch (error) {
                return done(error, undefined);
            }
        }
    )
);

// Routes
app.get('/api/auth/google', passport.authenticate('google', {
    scope: ['profile', 'email'],
}));

app.get(
    '/api/auth/google/callback',
    passport.authenticate('google', { session: false }),
    (req, res) => {
        // Generate JWT
        const tokens = generateTokens(req.user.id, req.user.email, req.user.role);
        // Redirect to frontend with token
        res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${tokens.accessToken}`);
    }
);
```

## Authorization Patterns

### Pattern 1: Role-Based Access Control (RBAC)

```typescript
enum Role {
    USER = 'user',
    MODERATOR = 'moderator',
    ADMIN = 'admin',
}

const roleHierarchy: Record<Role, Role[]> = {
    [Role.ADMIN]: [Role.ADMIN, Role.MODERATOR, Role.USER],
    [Role.MODERATOR]: [Role.MODERATOR, Role.USER],
    [Role.USER]: [Role.USER],
};

function hasRole(userRole: Role, requiredRole: Role): boolean {
    return roleHierarchy[userRole].includes(requiredRole);
}

// Middleware
function requireRole(...roles: Role[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        if (!roles.some(role => hasRole(req.user.role, role))) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    };
}

// Usage
app.delete('/api/users/:id',
    authenticate,
    requireRole(Role.ADMIN),
    async (req, res) => {
        // Only admins can delete users
        await db.users.delete(req.params.id);
        res.json({ message: 'User deleted' });
    }
);
```

### Pattern 2: Permission-Based Access Control

```typescript
enum Permission {
    READ_USERS = 'read:users',
    WRITE_USERS = 'write:users',
    DELETE_USERS = 'delete:users',
    READ_POSTS = 'read:posts',
    WRITE_POSTS = 'write:posts',
}

const rolePermissions: Record<Role, Permission[]> = {
    [Role.USER]: [Permission.READ_POSTS, Permission.WRITE_POSTS],
    [Role.MODERATOR]: [
        Permission.READ_POSTS,
        Permission.WRITE_POSTS,
        Permission.READ_USERS,
    ],
    [Role.ADMIN]: Object.values(Permission),
};

function hasPermission(userRole: Role, permission: Permission): boolean {
    return rolePermissions[userRole]?.includes(permission) ?? false;
}

function requirePermission(...permissions: Permission[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const hasAllPermissions = permissions.every(permission =>
            hasPermission(req.user.role, permission)
        );

        if (!hasAllPermissions) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    };
}

// Usage
app.get('/api/users',
    authenticate,
    requirePermission(Permission.READ_USERS),
    async (req, res) => {
        const users = await db.users.findAll();
        res.json({ users });
    }
);
```

### Pattern 3: Resource Ownership

```typescript
// Check if user owns resource
async function requireOwnership(
    resourceType: 'post' | 'comment',
    resourceIdParam: string = 'id'
) {
    return async (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const resourceId = req.params[resourceIdParam];

        // Admins can access anything
        if (req.user.role === Role.ADMIN) {
            return next();
        }

        // Check ownership
        let resource;
        if (resourceType === 'post') {
            resource = await db.posts.findById(resourceId);
        } else if (resourceType === 'comment') {
            resource = await db.comments.findById(resourceId);
        }

        if (!resource) {
            return res.status(404).json({ error: 'Resource not found' });
        }

        if (resource.userId !== req.user.userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        next();
    };
}

// Usage
app.put('/api/posts/:id',
    authenticate,
    requireOwnership('post'),
    async (req, res) => {
        // User can only update their own posts
        const post = await db.posts.update(req.params.id, req.body);
        res.json({ post });
    }
);
```

## Security Best Practices

### Pattern 1: Password Security

```typescript
import bcrypt from 'bcrypt';
import { z } from 'zod';

// Password validation schema
const passwordSchema = z.string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Password must contain uppercase letter')
    .regex(/[a-z]/, 'Password must contain lowercase letter')
    .regex(/[0-9]/, 'Password must contain number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain special character');

// Hash password
async function hashPassword(password: string): Promise<string> {
    const saltRounds = 12;  // 2^12 iterations
    return bcrypt.hash(password, saltRounds);
}

// Verify password
async function verifyPassword(
    password: string,
    hash: string
): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

// Registration with password validation
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate password
        passwordSchema.parse(password);

        // Check if user exists
        const existingUser = await db.users.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const passwordHash = await hashPassword(password);

        // Create user
        const user = await db.users.create({
            email,
            passwordHash,
        });

        // Generate tokens
        const tokens = generateTokens(user.id, user.email, user.role);

        res.status(201).json({
            user: { id: user.id, email: user.email },
            ...tokens,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors[0].message });
        }
        res.status(500).json({ error: 'Registration failed' });
    }
});
```

### Pattern 2: Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';

// Login rate limiter
const loginLimiter = rateLimit({
    store: new RedisStore({ client: redisClient }),
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 5,  // 5 attempts
    message: 'Too many login attempts, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

// API rate limiter
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,  // 1 minute
    max: 100,  // 100 requests per minute
    standardHeaders: true,
});

// Apply to routes
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    // Login logic
});

app.use('/api/', apiLimiter);
```

## Best Practices

1. **Never Store Plain Passwords**: Always hash with bcrypt/argon2
2. **Use HTTPS**: Encrypt data in transit
3. **Short-Lived Access Tokens**: 15-30 minutes max
4. **Secure Cookies**: httpOnly, secure, sameSite flags
5. **Validate All Input**: Email format, password strength
6. **Rate Limit Auth Endpoints**: Prevent brute force attacks
7. **Implement CSRF Protection**: For session-based auth
8. **Rotate Secrets Regularly**: JWT secrets, session secrets
9. **Log Security Events**: Login attempts, failed auth
10. **Use MFA When Possible**: Extra security layer

## Common Pitfalls

- **Weak Passwords**: Enforce strong password policies
- **JWT in localStorage**: Vulnerable to XSS, use httpOnly cookies
- **No Token Expiration**: Tokens should expire
- **Client-Side Auth Checks Only**: Always validate server-side
- **Insecure Password Reset**: Use secure tokens with expiration
- **No Rate Limiting**: Vulnerable to brute force
- **Trusting Client Data**: Always validate on server

## Resources

- **references/jwt-best-practices.md**: JWT implementation guide
- **references/oauth2-flows.md**: OAuth2 flow diagrams and examples
- **references/session-security.md**: Secure session management
- **assets/auth-security-checklist.md**: Security review checklist
- **assets/password-policy-template.md**: Password requirements template
- **scripts/token-validator.ts**: JWT validation utility
