import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserCuit } from './entities/user-cuit.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(UserCuit)
    private userCuitRepository: Repository<UserCuit>,
  ) {}

  async create(userData: Partial<User>) {
    if (userData.name) {
      userData.name = userData.name.toUpperCase();
    }

    const existingName = await this.usersRepository.findOne({ where: { name: userData.name } });
    if (existingName) {
      throw new ConflictException('Name already exists');
    }

    const existingUser = await this.usersRepository.findOne({ where: { email: userData.email } });
    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const salt = await bcrypt.genSalt();
    const password = userData.password || '';
    const hashedPassword = await (bcrypt.hash(password, salt) as Promise<string>);

    const user = this.usersRepository.create({
      ...userData,
      password: hashedPassword,
    });

    return this.usersRepository.save(user);
  }

  async findByEmail(email: string) {
    return this.usersRepository.findOne({ where: { email }, relations: ['cuits'] });
  }

  async findByName(name: string) {
    if (!name) return null;
    return this.usersRepository.findOne({ where: { name: name.toUpperCase() }, relations: ['cuits'] });
  }

  async updateEmail(userId: string, newEmail: string) {
    const user = await this.findById(userId);
    const existingUser = await this.usersRepository.findOne({ where: { email: newEmail } });
    if (existingUser && existingUser.id !== userId) {
      throw new ConflictException('Email already in use');
    }
    user.email = newEmail;
    return this.usersRepository.save(user);
  }

  async findById(id: string) {
    const user = await this.usersRepository.findOne({ where: { id }, relations: ['cuits'] });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async addCuit(userId: string, cuit: string) {
    const cleanCuit = cuit.replace(/\D/g, '');
    if (cleanCuit.length !== 11) {
      throw new BadRequestException('El CUIT debe tener exactamente 11 números');
    }

    const user = await this.findById(userId);
    
    if (user.cuits.length >= user.capacity) {
      throw new BadRequestException('User capacity reached');
    }

    const existingCuit = user.cuits.find(c => c.cuit === cleanCuit);
    if (existingCuit) {
      throw new ConflictException('Cuit already added for this user');
    }

    const newCuit = this.userCuitRepository.create({
      cuit: cleanCuit,
      user,
    });

    return this.userCuitRepository.save(newCuit);
  }

  async removeCuit(userId: string, cuitId: string) {
    const cuit = await this.userCuitRepository.findOne({ where: { id: cuitId, user: { id: userId } } });
    if (!cuit) {
      throw new NotFoundException('Cuit not found for this user');
    }
    return this.userCuitRepository.remove(cuit);
  }
}
