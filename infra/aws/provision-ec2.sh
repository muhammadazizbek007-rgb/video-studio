#!/usr/bin/env bash
#
# provision-ec2.sh — create the AWS footprint that video-studio runs on.
#
# Creates, in the default VPC of the target region:
#   - two SSH key pairs, generated LOCALLY (AWS never sees a private key)
#   - a security group allowing 22 from your address and 80/443 from anywhere
#   - one Ubuntu 24.04 instance, gp3 root volume, encrypted, IMDSv2 required
#   - an Elastic IP associated with it, so the address survives a stop/start
#
# Usage:
#   ./provision-ec2.sh
#   AWS_REGION=eu-west-1 INSTANCE_TYPE=t3.large ./provision-ec2.sh
#   ADMIN_CIDR=0.0.0.0/0 ./provision-ec2.sh          # opens SSH to the world
#
# Environment:
#   AWS_REGION      region to build in                    (default: eu-north-1)
#   AWS_PROFILE     credentials profile                   (default: the CLI default)
#   NAME            name tag / resource prefix            (default: video-studio)
#   INSTANCE_TYPE   EC2 instance type                     (default: t3.medium)
#   VOLUME_SIZE     root volume size in GiB               (default: 50)
#   ADMIN_CIDR      CIDR allowed to reach port 22         (default: this machine's /32)
#   KEY_DIR         where the generated keys are written  (default: ~/.ssh)
#
# Idempotent: every resource is looked up by name or tag before it is created, so
# re-running repairs a half-finished run instead of building a second copy.
set -euo pipefail

AWS_REGION="${AWS_REGION:-eu-north-1}"
NAME="${NAME:-video-studio}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.medium}"
VOLUME_SIZE="${VOLUME_SIZE:-50}"
KEY_DIR="${KEY_DIR:-$HOME/.ssh}"
SG_NAME="${NAME}-sg"
ADMIN_KEY_NAME="${NAME}-admin"
ADMIN_KEY_FILE="${KEY_DIR}/${NAME}-admin"
DEPLOY_KEY_FILE="${KEY_DIR}/${NAME}-deploy"

# Canonical publishes the current AMI id for every Ubuntu release as a public SSM
# parameter. Reading it beats hard-coding an id that is region-specific and goes
# stale on every image rebuild.
AMI_PARAM='/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id'

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

# `aws` is not on PATH in a Git Bash session started before the CLI was installed.
if command -v aws >/dev/null 2>&1; then
  AWS_BIN=aws
elif [ -x '/c/Program Files/Amazon/AWSCLIV2/aws.exe' ]; then
  AWS_BIN='/c/Program Files/Amazon/AWSCLIV2/aws.exe'
else
  die 'aws CLI not found — install AWS CLI v2 and re-run'
fi

aws_() { "$AWS_BIN" --region "$AWS_REGION" --output text "$@"; }

# On Git Bash the CLI is a native Windows binary and cannot resolve an MSYS path
# like /c/Users/... — a fileb:// argument built from $HOME would silently fail to
# open. cygpath exists only on MSYS/Cygwin, so its absence is the Linux/macOS case
# where the path is already native.
to_native_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

# `|| true` on every lookup: the CLI exits non-zero for a missing resource, which
# under `set -e` would abort a run that is merely discovering there is work to do.
lookup() { aws_ "$@" 2>/dev/null || true; }

log "Checking credentials"
CALLER="$(lookup sts get-caller-identity --query 'Arn')"
[ -n "$CALLER" ] || die 'no usable AWS credentials — run `aws configure` first'
log "Authenticated as ${CALLER}"
log "Region ${AWS_REGION}, instance ${INSTANCE_TYPE}, root volume ${VOLUME_SIZE} GiB"

# ---------------------------------------------------------------------------
# 1. SSH key pairs — generated here, so the private halves never leave this box.
# ---------------------------------------------------------------------------
# `install -d -m 700` also chmods a directory that already exists, and that fails on
# an NTFS path through MSYS, where POSIX mode bits are not settable. Creating and
# permissioning separately keeps the mode strict on Linux without aborting on Git Bash
# — ssh itself is what enforces key permissions, and it accepts Windows ACLs here.
mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR" 2>/dev/null || true

for pair in "admin:${ADMIN_KEY_FILE}" "deploy:${DEPLOY_KEY_FILE}"; do
  role="${pair%%:*}"
  path="${pair#*:}"
  if [ -f "$path" ]; then
    log "Reusing the existing ${role} key at ${path}"
  else
    log "Generating the ${role} key at ${path}"
    ssh-keygen -t ed25519 -N '' -C "${NAME}-${role}" -f "$path" >/dev/null
  fi
done

# Only the ADMIN key is registered with EC2 — it is what cloud-init installs for the
# `ubuntu` user. The deploy key is authorised later by provision-vps.sh for the
# unprivileged `deploy` account, and AWS has no reason to know about it.
if [ -n "$(lookup ec2 describe-key-pairs --key-names "$ADMIN_KEY_NAME" --query 'KeyPairs[0].KeyName')" ]; then
  log "Key pair ${ADMIN_KEY_NAME} is already registered"
else
  log "Importing ${ADMIN_KEY_NAME} into EC2"
  aws_ ec2 import-key-pair \
    --key-name "$ADMIN_KEY_NAME" \
    --public-key-material "fileb://$(to_native_path "${ADMIN_KEY_FILE}.pub")" \
    --query 'KeyName' >/dev/null
fi

# ---------------------------------------------------------------------------
# 2. Network — default VPC and one of its subnets.
# ---------------------------------------------------------------------------
VPC_ID="$(lookup ec2 describe-vpcs --filters 'Name=isDefault,Values=true' --query 'Vpcs[0].VpcId')"
[ -n "$VPC_ID" ] && [ "$VPC_ID" != 'None' ] \
  || die "no default VPC in ${AWS_REGION} — create one with: aws ec2 create-default-vpc --region ${AWS_REGION}"

SUBNET_ID="$(lookup ec2 describe-subnets \
  --filters "Name=vpc-id,Values=${VPC_ID}" 'Name=default-for-az,Values=true' \
  --query 'Subnets[0].SubnetId')"
[ -n "$SUBNET_ID" ] && [ "$SUBNET_ID" != 'None' ] || die "no default subnet found in ${VPC_ID}"
log "Using VPC ${VPC_ID}, subnet ${SUBNET_ID}"

# ---------------------------------------------------------------------------
# 3. Security group.
# ---------------------------------------------------------------------------
if [ -z "${ADMIN_CIDR:-}" ]; then
  MY_IP="$(curl -fsS --max-time 10 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)"
  if printf '%s' "$MY_IP" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
    ADMIN_CIDR="${MY_IP}/32"
    log "Restricting SSH to ${ADMIN_CIDR} (this machine)"
  else
    ADMIN_CIDR='0.0.0.0/0'
    warn 'could not determine this machine public IP — opening SSH to 0.0.0.0/0'
    warn 'narrow it later:  aws ec2 revoke-security-group-ingress ...'
  fi
fi

SG_ID="$(lookup ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=${VPC_ID}" "Name=group-name,Values=${SG_NAME}" \
  --query 'SecurityGroups[0].GroupId')"

if [ -n "$SG_ID" ] && [ "$SG_ID" != 'None' ]; then
  log "Reusing security group ${SG_NAME} (${SG_ID})"
else
  log "Creating security group ${SG_NAME}"
  SG_ID="$(aws_ ec2 create-security-group \
    --group-name "$SG_NAME" \
    --description "${NAME} edge: ssh from admin, http/https from anywhere" \
    --vpc-id "$VPC_ID" \
    --query 'GroupId')"
fi

# authorize-security-group-ingress fails with InvalidPermission.Duplicate on a rule
# that is already there, which is exactly the no-op we want on a re-run.
#
# The description carries no spaces on purpose: --ip-permissions takes CLI shorthand,
# where an unquoted space ends the value and a shell-quoted one is passed through
# literally, quotes included.
authorize() {
  local port="$1" cidr="$2" note="$3"
  if aws_ ec2 authorize-security-group-ingress \
      --group-id "$SG_ID" \
      --ip-permissions "IpProtocol=tcp,FromPort=${port},ToPort=${port},IpRanges=[{CidrIp=${cidr},Description=${note}}]" \
      >/dev/null 2>&1; then
    log "  opened ${port}/tcp to ${cidr}"
  else
    log "  ${port}/tcp from ${cidr} already allowed"
  fi
}
authorize 22  "$ADMIN_CIDR" admin-ssh
authorize 80  '0.0.0.0/0'   http-and-acme
authorize 443 '0.0.0.0/0'   https

# The deploy workflow reaches this box over SSH from a GitHub-hosted runner, whose
# address is not knowable in advance: Actions publishes hundreds of CIDRs that rotate,
# and a security group takes 60 rules. So 22 has to be reachable from anywhere for CI
# to deploy at all — which is what provision-vps.sh already assumes, since it opens
# 22 in ufw unconditionally.
#
# What actually protects the port is sshd, not the security group: passwords are
# disabled, only keys are accepted, MaxAuthTries is 3 and fail2ban bans for an hour
# after 4 failures. Set CI_SSH=0 to keep 22 restricted to ADMIN_CIDR — deploys then
# have to run from an allowed address, or from a self-hosted runner on the instance.
if [ "${CI_SSH:-1}" = '1' ]; then
  authorize 22 '0.0.0.0/0' ssh-for-github-actions-deploy
else
  warn 'CI_SSH=0 — GitHub Actions will NOT be able to deploy to this host'
fi

# ---------------------------------------------------------------------------
# 4. The instance.
# ---------------------------------------------------------------------------
# Terminated instances linger in describe-instances for about an hour; excluding
# them stops a re-run from adopting a corpse instead of building a replacement.
INSTANCE_ID="$(lookup ec2 describe-instances \
  --filters "Name=tag:Name,Values=${NAME}" \
            'Name=instance-state-name,Values=pending,running,stopping,stopped' \
  --query 'Reservations[0].Instances[0].InstanceId')"

if [ -n "$INSTANCE_ID" ] && [ "$INSTANCE_ID" != 'None' ]; then
  log "Reusing instance ${INSTANCE_ID} (tagged ${NAME})"
else
  # Preferred source: Canonical's public SSM parameter. It needs ssm:GetParameter,
  # which AmazonEC2FullAccess does NOT grant — so a deployer user carrying only that
  # policy falls through to describe-images, which ec2:Describe* does cover.
  AMI_ID="$(lookup ssm get-parameter --name "$AMI_PARAM" --query 'Parameter.Value')"
  if [ -z "$AMI_ID" ] || [ "$AMI_ID" = 'None' ]; then
    warn 'SSM lookup failed (missing ssm:GetParameter?) — falling back to describe-images'
    # 099720109477 is Canonical's account. Filtering by owner-id rather than by a name
    # alone matters: anyone may publish an image called ubuntu-noble-*, and picking the
    # newest match by name would be trusting a stranger's AMI.
    AMI_ID="$(lookup ec2 describe-images \
      --owners 099720109477 \
      --filters 'Name=name,Values=ubuntu/images/hvm-ssd*/ubuntu-noble-24.04-amd64-server-*' \
                'Name=state,Values=available' \
                'Name=architecture,Values=x86_64' \
      --query 'sort_by(Images, &CreationDate)[-1].ImageId')"
  fi
  [ -n "$AMI_ID" ] && [ "$AMI_ID" != 'None' ] \
    || die 'cannot resolve the Ubuntu 24.04 AMI via SSM or describe-images'
  log "Launching ${INSTANCE_TYPE} from ${AMI_ID}"

  # Burstable-only argument: run-instances rejects it outright for an m5/c5/etc,
  # which INSTANCE_TYPE is documented as being allowed to select. `standard` rather
  # than `unlimited` so a sustained CPU pin throttles instead of quietly billing.
  CREDIT_ARGS=()
  case "$INSTANCE_TYPE" in
    t2.*|t3.*|t3a.*|t4g.*) CREDIT_ARGS=(--credit-specification 'CpuCredits=standard') ;;
  esac

  INSTANCE_ID="$(aws_ ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$ADMIN_KEY_NAME" \
    --subnet-id "$SUBNET_ID" \
    --security-group-ids "$SG_ID" \
    --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":${VOLUME_SIZE},\"VolumeType\":\"gp3\",\"Encrypted\":true,\"DeleteOnTermination\":true}}]" \
    --metadata-options 'HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=1' \
    ${CREDIT_ARGS[@]+"${CREDIT_ARGS[@]}"} \
    --tag-specifications \
      "ResourceType=instance,Tags=[{Key=Name,Value=${NAME}}]" \
      "ResourceType=volume,Tags=[{Key=Name,Value=${NAME}-root}]" \
    --query 'Instances[0].InstanceId')"
  log "Launched ${INSTANCE_ID}"
fi

log 'Waiting for the instance to reach running'
aws_ ec2 wait instance-running --instance-ids "$INSTANCE_ID"

# ---------------------------------------------------------------------------
# 5. Elastic IP — a stop/start otherwise hands back a different public address,
#    which would silently break DNS and the deploy workflow's known_hosts.
# ---------------------------------------------------------------------------
ALLOC_ID="$(lookup ec2 describe-addresses --filters "Name=tag:Name,Values=${NAME}" --query 'Addresses[0].AllocationId')"
if [ -z "$ALLOC_ID" ] || [ "$ALLOC_ID" = 'None' ]; then
  log 'Allocating an Elastic IP'
  ALLOC_ID="$(aws_ ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${NAME}}]" \
    --query 'AllocationId')"
fi

ASSOCIATED_TO="$(lookup ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].InstanceId')"
if [ "$ASSOCIATED_TO" != "$INSTANCE_ID" ]; then
  log "Associating ${ALLOC_ID} with ${INSTANCE_ID}"
  aws_ ec2 associate-address --allocation-id "$ALLOC_ID" --instance-id "$INSTANCE_ID" --query 'AssociationId' >/dev/null
fi

PUBLIC_IP="$(lookup ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].PublicIp')"
[ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != 'None' ] || die 'the Elastic IP has no public address'

log 'Waiting for both status checks to pass (this takes a couple of minutes)'
aws_ ec2 wait instance-status-ok --instance-ids "$INSTANCE_ID"

# ---------------------------------------------------------------------------
# 6. Host key — the deploy workflow verifies it, so capture it now rather than
#    letting a human accept an unverified fingerprint later.
# ---------------------------------------------------------------------------
KNOWN_HOSTS_FILE="${KEY_DIR}/${NAME}-known_hosts"
log "Scanning the host key into ${KNOWN_HOSTS_FILE}"
: > "$KNOWN_HOSTS_FILE"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if ssh-keyscan -T 10 -t ed25519,rsa "$PUBLIC_IP" >> "$KNOWN_HOSTS_FILE" 2>/dev/null \
     && [ -s "$KNOWN_HOSTS_FILE" ]; then
    break
  fi
  # sshd answers a few seconds after the status checks clear, not at the same moment.
  log "  sshd not answering yet (attempt ${attempt}/10)"
  sleep 10
done
[ -s "$KNOWN_HOSTS_FILE" ] || warn "could not scan the host key — run: ssh-keyscan ${PUBLIC_IP} > ${KNOWN_HOSTS_FILE}"

cat <<SUMMARY

------------------------------------------------------------------------------
 AWS resources ready
------------------------------------------------------------------------------

 region        : ${AWS_REGION}
 instance      : ${INSTANCE_ID}  (${INSTANCE_TYPE}, ${VOLUME_SIZE} GiB gp3, encrypted)
 security group: ${SG_ID}  (22 from ${ADMIN_CIDR}, 80/443 from 0.0.0.0/0)
 elastic ip    : ${PUBLIC_IP}  (allocation ${ALLOC_ID})

 admin key     : ${ADMIN_KEY_FILE}          -> ssh ubuntu@${PUBLIC_IP}
 deploy key    : ${DEPLOY_KEY_FILE}         -> becomes the VPS_SSH_KEY secret
 known hosts   : ${KNOWN_HOSTS_FILE}        -> becomes VPS_SSH_KNOWN_HOSTS

 NEXT

 1. Provision the box (installs docker, creates the deploy user, hardens sshd):

      ./infra/aws/bootstrap-ec2.sh ${PUBLIC_IP}

 2. Point DNS at ${PUBLIC_IP}:

      studio.haywan.uz.       A   ${PUBLIC_IP}
      studio-api.haywan.uz.   A   ${PUBLIC_IP}

 3. Fill in /opt/video-studio/shared/env/api.env on the box, set the GitHub
    secrets printed by bootstrap-ec2.sh, then push to main.

 COST: an unassociated Elastic IP is billed by the hour, and so is an associated
 one. Releasing the address when you tear the instance down is not optional
 housekeeping — it is a line on the bill.
------------------------------------------------------------------------------

SUMMARY
