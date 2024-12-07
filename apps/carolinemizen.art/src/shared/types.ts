export interface User {
  id: number;
  dateCreated: Date;
  // name: string;
  email: string;
  password: string;
  role: string;
}

export interface UserDB {
  id: number;
  dateCreated?: Date;
  // name: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  role: string;
}
