import type { User } from '@shared/types';

export type CreateUserDto = Omit<User, 'id' | 'dateCreated' | 'role'> & {
  role?: string;
};
