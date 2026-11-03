#include <stdio.h>
#include "esp_netif_ip_addr.h"
#include "mdns.h"
#include "body_url.h"
#include "discover.h"

/* Without the A record in the answer's extras, ask for the host's address. */
static bool ipv4_of(const mdns_result_t *r, char *out, size_t cap, uint32_t timeout_ms) {
  for (const mdns_ip_addr_t *a = r->addr; a; a = a->next) {
    if (a->addr.type == ESP_IPADDR_TYPE_V4) {
      esp_ip4addr_ntoa(&a->addr.u_addr.ip4, out, cap);
      return true;
    }
  }
  if (!r->hostname) return false;
  esp_ip4_addr_t ip;
  if (mdns_query_a(r->hostname, timeout_ms, &ip) != ESP_OK) return false;
  esp_ip4addr_ntoa(&ip, out, cap);
  return true;
}

bool discover_brain(char *url_out, size_t cap, uint32_t timeout_ms) {
  static bool started;
  if (!started) {
    if (mdns_init() != ESP_OK) return false;
    started = true;
  }
  mdns_result_t *found = NULL;
  if (mdns_query_ptr("_beasaltfish", "_tcp", timeout_ms, 1, &found) != ESP_OK || !found) return false;
  char host[16];
  bool ok = ipv4_of(found, host, sizeof host, timeout_ms) && body_url_build(url_out, cap, host, found->port) > 0;
  mdns_query_results_free(found);
  return ok;
}
