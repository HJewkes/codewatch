// VIOLATIONS: snake_case vars, wrong import order, no JSDoc on exports, mixed semicolons

// Relative imports FIRST (violates: should be last)
import { helper_fn } from './utils'
import { local_config } from '../config'

// Builtin imports SECOND (violates: should be first)
import * as path from 'node:path'
import * as fs from 'node:fs'

// External imports LAST (violates: should be second)
import { z } from 'zod'

const max_retries = 3
const user_name = 'alice';
let is_active = true
let account_balance = 100;

interface user_profile {
  first_name: string
  last_name: string;
  email_address: string
}

type api_response = {
  status_code: number;
  response_body: unknown
}

export function fetch_user_data(user_id: string): Promise<user_profile> {
  if (!user_id) {
    return Promise.reject('missing id')
  }

  return helper_fn(`/users/${user_id}`)
}

export async function update_user(user_id: string, data: user_profile) {
  const file_path = path.join('/tmp', user_id);
  fs.writeFileSync(file_path, JSON.stringify(data))

  try {
    const result = await helper_fn(`/users/${user_id}`)
    return result;
  } catch (e) {
    console.error(e)
    throw e
  }
}

function process_items(item_list: string[]) {
  const result_list: string[] = []
  for (const item of item_list) {
    if (item !== null && item !== undefined) {
      result_list.push(item.toUpperCase());
    }
  }
  return result_list
}

export const get_config = () => {
  const config_data = local_config
  return config_data
}
