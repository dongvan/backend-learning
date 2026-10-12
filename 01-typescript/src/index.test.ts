import { describe, it, expect } from 'vitest';

// Demo Utility Type & Function
type User = {
    id: string;
    name: string;
    role: 'admin' | 'user';
};

function getUserRole(user: User): string {
    return user.role;
}

describe('01 - Type System Setup Test', () => {
    it('should compile and pass type checks correctly', () => {
        const mockUser: User = { id: '1', name: 'Dev', role: 'admin' };
        expect(getUserRole(mockUser)).toBe('admin');
    });
});