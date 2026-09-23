import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usersService } from '../../services/users.service';
import { CreateUserPayload, User } from '../../types/users';

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation<User, Error, CreateUserPayload>({
    mutationFn: (payload: CreateUserPayload) => usersService.createUser(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(['currentUser'], data);
    },
  });
}
