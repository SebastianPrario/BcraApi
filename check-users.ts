import { createConnection } from 'typeorm';
import { User } from './src/users/entities/user.entity';
import { UserCuit } from './src/users/entities/user-cuit.entity';
import { Alert } from './src/alerts/entities/alert.entity';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkUsers() {
  const connection = await createConnection({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [User, UserCuit, Alert],
    synchronize: false,
  });

  const userRepository = connection.getRepository(User);
  const users = await userRepository.find({ relations: ['cuits'] });
  console.log('Users in DB:');
  console.log(JSON.stringify(users, null, 2));

  await connection.close();
}

checkUsers().catch(console.error);
